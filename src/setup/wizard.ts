/**
 * First-run setup wizard
 *
 * Guides users through initial configuration when no config.json exists.
 * - Asks for master folder location
 * - Copies ~/.claude to master folder if needed (serves as backup)
 * - Detects existing Claude account directories
 * - Generates config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { expandPath } from '../utils/files';

const HOME = process.env.HOME || '';
const DEFAULT_MASTER_FOLDER = '~/.claude-hub-master';
const DEFAULT_CLAUDE_DIR = path.join(HOME, '.claude');

interface SetupResult {
  accounts: Record<string, string>;
  masterFolder: string;
  syncOnStart: boolean;
}

/**
 * Create readline interface for user input
 */
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompt user for input with a default value
 */
async function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const displayQuestion = defaultValue
      ? `${question} [${defaultValue}]: `
      : `${question}: `;

    rl.question(displayQuestion, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt for yes/no with default
 */
async function promptYesNo(rl: readline.Interface, question: string, defaultYes: boolean = true): Promise<boolean> {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = await prompt(rl, `${question} ${hint}`);

  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

/**
 * Detect existing Claude config directories
 * @param excludePath - Path to exclude from detection (e.g., master folder)
 */
function detectExistingAccounts(excludePath?: string): Array<{ path: string; suggestedName: string }> {
  const accounts: Array<{ path: string; suggestedName: string }> = [];
  const excludeExpanded = excludePath ? expandPath(excludePath) : null;

  try {
    const homeContents = fs.readdirSync(HOME);

    for (const entry of homeContents) {
      if (entry.startsWith('.claude')) {
        const fullPath = path.join(HOME, entry);

        // Skip the master folder
        if (excludeExpanded && fullPath === excludeExpanded) {
          continue;
        }

        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Check if it looks like a Claude config dir
          const hasProjects = fs.existsSync(path.join(fullPath, 'projects'));
          const hasConfig = fs.existsSync(path.join(fullPath, '.claude.json'));

          if (hasProjects || hasConfig) {
            // Generate suggested name
            let suggestedName: string;
            if (entry === '.claude') {
              suggestedName = 'main';
            } else {
              // .claude2 -> account2, .claude-work -> work
              suggestedName = entry.replace(/^\.claude-?/, '') || 'account';
              if (/^\d+$/.test(suggestedName)) {
                suggestedName = `account${suggestedName}`;
              }
            }

            accounts.push({ path: `~/${entry}`, suggestedName });
          }
        }
      }
    }
  } catch (err) {
    // Ignore errors scanning home directory
  }

  // Sort so .claude comes first
  accounts.sort((a, b) => {
    if (a.path === '~/.claude') return -1;
    if (b.path === '~/.claude') return 1;
    return a.path.localeCompare(b.path);
  });

  return accounts;
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip certain directories
    if (entry.name === 'cache' || entry.name === 'debug') {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create empty master folder structure
 */
function createEmptyMasterFolder(masterPath: string): void {
  fs.mkdirSync(masterPath, { recursive: true });
  fs.mkdirSync(path.join(masterPath, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(masterPath, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(masterPath, 'skills'), { recursive: true });
}

/**
 * Run the setup wizard
 */
export async function runSetupWizard(): Promise<SetupResult | null> {
  const rl = createReadline();

  console.log('');
  console.log('┌─ Claude Hub Setup ─────────────────────────────────────┐');
  console.log('│ No configuration found. Let\'s set things up!           │');
  console.log('└────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('Master folder is where your agents, commands, and skills');
  console.log('are synced from. It\'s the "source of truth" for extensions.');
  console.log('');
  console.log('If the folder doesn\'t exist, your ~/.claude will be copied');
  console.log('there as a starting point (also serves as a backup).');
  console.log('');

  try {
    // 1. Ask for master folder location
    const masterFolderInput = await prompt(rl, 'Master folder path', DEFAULT_MASTER_FOLDER);
    const masterFolder = expandPath(masterFolderInput);

    // 2. Handle master folder creation
    const masterExists = fs.existsSync(masterFolder);
    const defaultClaudeExists = fs.existsSync(DEFAULT_CLAUDE_DIR);

    if (masterExists) {
      console.log(`✓ Using existing master folder: ${masterFolderInput}`);
    } else if (defaultClaudeExists) {
      console.log(`Creating master folder...`);
      copyDirRecursive(DEFAULT_CLAUDE_DIR, masterFolder);
      console.log(`✓ Created ${masterFolderInput} (copied from ~/.claude)`);
      console.log('  This also serves as a backup of your original config.');
    } else {
      console.log(`Creating empty master folder...`);
      createEmptyMasterFolder(masterFolder);
      console.log(`✓ Created ${masterFolderInput}`);
    }

    console.log('');

    // 3. Detect existing accounts (exclude master folder)
    const detectedAccounts = detectExistingAccounts(masterFolderInput);
    const selectedAccounts: Record<string, string> = {};

    if (detectedAccounts.length > 0) {
      console.log('Found existing Claude configs:');

      for (const account of detectedAccounts) {
        const addThis = await promptYesNo(
          rl,
          `  ${account.path} → add as "${account.suggestedName}"?`,
          true
        );

        if (addThis) {
          selectedAccounts[account.suggestedName] = account.path;
        }
      }

      console.log('');
    }

    // If no accounts were selected/detected, show a message
    if (Object.keys(selectedAccounts).length === 0) {
      console.log('No accounts configured. You can add accounts later with:');
      console.log('  hub --add-account <name>');
      console.log('');
    }

    rl.close();

    return {
      accounts: selectedAccounts,
      masterFolder: masterFolderInput, // Store unexpanded path
      syncOnStart: true,
    };

  } catch (err) {
    rl.close();

    if ((err as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      // User pressed Ctrl+C
      console.log('\n\nSetup cancelled.');
      return null;
    }

    throw err;
  }
}

/**
 * Save config to config.json
 */
export function saveSetupConfig(config: SetupResult, configPath: string): void {
  const configContent = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, configContent);

  console.log('Configuration saved to config.json:');
  console.log(`  Master folder: ${config.masterFolder}`);
  console.log(`  Accounts: ${Object.keys(config.accounts).join(', ') || '(none)'}`);
  console.log(`  Sync on start: ${config.syncOnStart}`);
  console.log('');
  console.log('Run `hub` again to start using Claude Hub!');
  console.log('Add more accounts anytime with: hub --add-account <name>');
}
