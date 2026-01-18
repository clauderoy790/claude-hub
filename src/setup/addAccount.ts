/**
 * Add Account Command
 *
 * Handles `hub --add-account <name>` to create a new Claude account.
 * - Validates account name
 * - Creates config directory
 * - Launches Claude for authentication via PTY
 * - Auto-exits after authentication completes (detects "Login successful")
 * - Updates config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { spawnSync } from 'child_process';
import * as pty from 'node-pty';
import { Config, saveConfig } from '../config';
import { expandPath } from '../utils/files';

const HOME = process.env.HOME || '';

/**
 * Mark onboarding as complete in the account's .claude.json
 *
 * When we auto-exit after "Login successful", Claude hasn't shown the onboarding
 * wizard yet (theme selection, etc.). Without this flag, Claude will show the
 * onboarding screen every time it launches. We set it ourselves to skip that.
 */
function markOnboardingComplete(configDir: string): boolean {
  const configFile = path.join(configDir, '.claude.json');

  try {
    if (!fs.existsSync(configFile)) {
      return false;
    }

    const content = fs.readFileSync(configFile, 'utf-8');
    const config = JSON.parse(content);

    // Add the onboarding flag
    config.hasCompletedOnboarding = true;

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    return true;
  } catch {
    // Non-fatal - Claude will just show onboarding wizard
    return false;
  }
}

// ============================================================================
// AUTH DETECTION CONFIGURATION
// ============================================================================
// Claude CLI outputs a success message after authentication completes.
// We use PTY to run Claude (so it thinks it's a real terminal) while
// monitoring the output for the success string.
//
// If Claude changes their output format, update AUTH_SUCCESS_STRING.
// To find the new string, run:
//   CLAUDE_CONFIG_DIR=/tmp/test-auth claude
// And look for the success message after authenticating in the browser.
// ============================================================================

/**
 * String that indicates authentication was successful.
 * Claude outputs this after the user completes browser auth.
 * As of Claude Code v2.1.27, the full message is:
 *   "Login successful. Press Enter to continue…"
 */
const AUTH_SUCCESS_STRING = 'Login successful';

/**
 * How long to wait (ms) after detecting auth success before killing Claude.
 * This gives time for any final writes to complete.
 */
const AUTH_SUCCESS_DELAY_MS = 1500;

// ============================================================================

/**
 * Validate account name
 * Only alphanumeric, dashes, and underscores allowed
 */
export function validateAccountName(name: string): { valid: boolean; error?: string } {
  if (!name) {
    return { valid: false, error: 'Account name is required' };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return {
      valid: false,
      error: 'Account name can only contain letters, numbers, dashes, and underscores',
    };
  }

  if (name.length > 50) {
    return { valid: false, error: 'Account name is too long (max 50 characters)' };
  }

  return { valid: true };
}

/**
 * Generate config directory path for account name
 */
export function getAccountConfigDir(name: string): string {
  // Special case: "main" uses default ~/.claude
  if (name === 'main') {
    return '~/.claude';
  }
  return `~/.claude-${name}`;
}

/**
 * Prompt user to press Enter to continue
 */
async function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Resolve the full path to the claude command
 */
function resolveClaudeCommand(): string {
  try {
    const result = spawnSync('which', ['claude'], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Fall through
  }
  return 'claude';
}

/**
 * Launch Claude for authentication using PTY and auto-exit when complete.
 *
 * Uses PTY (pseudo-terminal) so Claude thinks it's running in a real terminal,
 * while we monitor the output for AUTH_SUCCESS_STRING.
 * Once detected, waits briefly then kills Claude.
 *
 * @returns Promise that resolves to true if auth succeeded, false otherwise
 */
async function launchClaudeForAuth(claudePath: string, configDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    let authDetected = false;
    let outputBuffer = '';

    // Spawn Claude in a PTY so it runs in full interactive mode
    const ptyProcess = pty.spawn(claudePath, [], {
      name: 'xterm-256color',
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
      } as { [key: string]: string },
    });

    // Handle terminal resize
    const onResize = () => {
      ptyProcess.resize(
        process.stdout.columns || 80,
        process.stdout.rows || 24
      );
    };
    process.stdout.on('resize', onResize);

    // Monitor output from Claude
    ptyProcess.onData((data: string) => {
      // Pass through to user's terminal
      process.stdout.write(data);

      // Accumulate output for detection
      outputBuffer += data;

      // ================================================================
      // AUTH DETECTION LOGIC
      // ================================================================
      // Check if the output contains our success string.
      // If Claude changes their auth flow, update AUTH_SUCCESS_STRING above.
      // ================================================================
      if (!authDetected && outputBuffer.includes(AUTH_SUCCESS_STRING)) {
        authDetected = true;

        // Wait a moment for credentials to be fully saved to disk,
        // then gracefully terminate Claude
        setTimeout(() => {
          ptyProcess.kill();
        }, AUTH_SUCCESS_DELAY_MS);
      }

      // Keep buffer from growing too large (only need recent output)
      if (outputBuffer.length > 10000) {
        outputBuffer = outputBuffer.slice(-5000);
      }
    });

    // Forward user input to Claude
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onStdinData = (data: Buffer) => {
      ptyProcess.write(data.toString());
    };
    process.stdin.on('data', onStdinData);

    // Handle process exit
    ptyProcess.onExit(({ exitCode }) => {
      // Clean up
      process.stdout.removeListener('resize', onResize);
      process.stdin.removeListener('data', onStdinData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      // Auth is successful if we detected the success string,
      // OR if Claude exited normally (code 0) after user manually exited
      resolve(authDetected || exitCode === 0);
    });
  });
}

/**
 * Add a new account
 */
export async function addAccount(name: string, config: Config): Promise<boolean> {
  // Validate name
  const validation = validateAccountName(name);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    console.error('Example: hub --add-account work');
    return false;
  }

  // Check if account already exists in config
  if (config.accounts[name]) {
    console.error(`Error: Account "${name}" already exists in config.json`);
    console.error(`  Config directory: ${config.accounts[name]}`);
    return false;
  }

  // Generate config directory path
  const configDirPath = getAccountConfigDir(name);
  const expandedPath = expandPath(configDirPath);

  // Check if directory already exists
  if (fs.existsSync(expandedPath)) {
    console.error(`Error: Directory ${configDirPath} already exists`);
    console.error('If you want to use this existing account, add it manually to config.json:');
    console.error(`  "${name}": "${configDirPath}"`);
    return false;
  }

  console.log('');
  console.log(`Creating account "${name}"...`);
  console.log('');
  console.log('┌─ Before continuing ─────────────────────────────────────┐');
  console.log('│ 1. Go to claude.ai in your browser                      │');
  console.log(`│ 2. Log in with the account you want for "${name}"`.padEnd(57) + '│');
  console.log('│    (Log out first if you\'re on a different account)     │');
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('When you press Enter:');
  console.log('  • Claude CLI will launch');
  console.log('  • Your browser will open for authorization');
  console.log('  • Hub will auto-exit after authentication completes');
  console.log('');

  await waitForEnter('Press Enter to continue (Ctrl+C to cancel)...');

  // Create the directory
  fs.mkdirSync(expandedPath, { recursive: true });

  // Launch Claude with the new config directory
  console.log('');
  console.log('Launching Claude for authorization...');
  console.log('');

  const claudePath = resolveClaudeCommand();
  const authSuccess = await launchClaudeForAuth(claudePath, expandedPath);

  // Check if authentication succeeded by looking for credentials
  const hasCredentials = fs.existsSync(path.join(expandedPath, '.claude.json'));
  const hasProjects = fs.existsSync(path.join(expandedPath, 'projects'));

  // Mark onboarding as complete so Claude doesn't show the setup wizard
  // (We killed Claude after "Login successful" but before the onboarding wizard)
  if (hasCredentials) {
    markOnboardingComplete(expandedPath);
  }

  if (!hasCredentials && !hasProjects) {
    console.log('');
    console.log('Warning: Authentication may not have completed.');
    console.log(`Directory ${configDirPath} was created but appears empty.`);
    console.log('');

    // Ask if they want to add anyway
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Add this account anyway? (y/N): ', resolve);
    });
    rl.close();

    if (!answer.toLowerCase().startsWith('y')) {
      // Clean up the directory
      fs.rmSync(expandedPath, { recursive: true, force: true });
      console.log('Account creation cancelled. Directory removed.');
      return false;
    }
  }

  // Update config
  config.accounts[name] = configDirPath;
  saveConfig(config);

  console.log('');
  console.log(`✓ Account "${name}" added!`);
  console.log(`  Config: ${configDirPath}`);
  console.log('');
  console.log(`Run 'hub' to start using your accounts.`);

  return true;
}
