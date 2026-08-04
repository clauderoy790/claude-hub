#!/usr/bin/env node

/**
 * Claude Hub CLI - Manages multiple Claude Code accounts with smart load balancing
 *
 * Features:
 * - Auto-selects best account based on usage data
 * - Syncs conversations across all accounts
 * - Detects rate limits at runtime and auto-switches to another account
 * - Preserves session continuity when switching
 */

import { loadConfig, validateConfig, configExists, getConfigPath } from './config';
import { syncConversations, listConversations, syncHistory, syncExtensions, syncMcp } from './sync';
import { runSetupWizard, saveSetupConfig, addAccount, handleRenameAccount } from './setup';
import {
  getAllAPIUsage,
  displayAPIUsage,
  selectBestAccount,
  selectNextAccount,
  formatResetTime,
  registerSession,
  unregisterSession,
  getScoreBreakdown,
  getConfigValues,
  clearUsageCache,
  APIUsageData,
} from './usage';
import { createPtyWrapper, cleanupTerminal } from './pty';
import {
  handleLoginCommand,
  runLogin,
  offerRenewal,
  getLoginStatus,
  getAllLoginStatus,
  needsLogin,
  buildAuthEnv,
  resolveProfileDirectory,
  isChromeAvailable,
  LoginStatus,
} from './auth';
import { renderStartupBox, displayVerboseSyncDetails, SyncSummary } from './display';
import { executeCommand, CommandContext } from './commands';
import { launchClaudeWindows } from './launch/windows';
import { findActiveSessionId } from './utils/session';
import { spawn } from 'child_process';
import * as os from 'os';

interface CliArgs {
  sync: boolean;
  verbose: boolean;
  list: boolean;
  help: boolean;
  usage: boolean;
  score: boolean;
  noAutoSwitch: boolean;
  account: string | null;
  addAccount: string | null;
  renameAccount: { oldName: string; newName: string } | null;
  mcpArgs: string[] | null;
  loginArgs: string[] | null;
  claudeArgs: string[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  // Detect `hub mcp <subcommand> [args...]` — everything after 'mcp' is MCP args
  let mcpArgs: string[] | null = null;
  if (args[0] === 'mcp') {
    mcpArgs = args.slice(1);
  }

  // Detect `hub login [account]`
  let loginArgs: string[] | null = null;
  if (args[0] === 'login') {
    loginArgs = args.slice(1);
  }

  // Find --account flag
  let account: string | null = null;
  const accountIndex = args.indexOf('--account');
  if (accountIndex !== -1 && accountIndex + 1 < args.length) {
    account = args[accountIndex + 1];
  }

  // Find --add-account flag
  let addAccount: string | null = null;
  const addAccountIndex = args.indexOf('--add-account');
  if (addAccountIndex !== -1 && addAccountIndex + 1 < args.length) {
    addAccount = args[addAccountIndex + 1];
  }

  // Find --rename-account flag (expects two arguments: old name, new name)
  let renameAccount: { oldName: string; newName: string } | null = null;
  const renameAccountIndex = args.indexOf('--rename-account');
  if (renameAccountIndex !== -1 && renameAccountIndex + 2 < args.length) {
    renameAccount = {
      oldName: args[renameAccountIndex + 1],
      newName: args[renameAccountIndex + 2],
    };
  }

  // Separate hub flags from claude args
  const hubFlags = ['--sync', '--help', '-h', '--list', '-v', '--verbose', '--account', '--usage', '--score', '--no-auto-switch', '--add-account', '--rename-account'];
  const claudeArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip hub flags and their values
    if (hubFlags.includes(arg)) {
      if (arg === '--account' || arg === '--add-account') {
        i++; // Skip the value too
      }
      if (arg === '--rename-account') {
        i += 2; // Skip both old and new name values
      }
      continue;
    }

    // All other args are for claude
    claudeArgs.push(arg);
  }

  return {
    sync: args.includes('--sync'),
    verbose: args.includes('-v') || args.includes('--verbose'),
    list: args.includes('--list'),
    // `hub login --help` belongs to the login subcommand, not the global help
    help: (args.includes('--help') || args.includes('-h')) && args[0] !== 'login',
    usage: args.includes('--usage'),
    score: args.includes('--score'),
    noAutoSwitch: args.includes('--no-auto-switch'),
    account,
    addAccount,
    renameAccount,
    mcpArgs,
    loginArgs,
    claudeArgs,
  };
}

function showHelp(): void {
  console.log(`
Claude Hub - Sync and manage multiple Claude Code accounts

Usage:
  hub                              Auto-select best account, sync, and run claude
  hub --account <name>             Use specific account (skip auto-selection)
  hub --add-account <name>         Add a new Claude account
  hub --rename-account <old> <new> Rename an account
  hub --sync                       Sync only, don't run claude
  hub --usage                      Show combined usage across all accounts
  hub login                        Show login status for all accounts
  hub login <account>              Sign an account in (in its own browser profile)
  hub mcp add <name> [args]        Add MCP server (synced to all accounts)
  hub mcp remove <name>            Remove MCP server from all accounts
  hub mcp list                     List MCP servers
  hub --help                       Show this help message
  hub [claude args]                Pass remaining args to claude

Options:
  --account <name>              Use specific account (as named in config.json)
  --add-account <name>          Add a new account (launches Claude to authenticate)
  --rename-account <old> <new>  Rename an existing account
  --no-auto-switch              Disable automatic account switching on rate limit
  --sync                        Sync only, don't run claude
  --usage                       Show combined usage across all accounts
  --score                       Show usage scoring breakdown (for tuning algorithm)
  -v, --verbose                 Show detailed sync output
  --list                        List conversations per account (debug)
  -h, --help                    Show help

Keyboard Shortcuts (while Claude is running):
  F9                            Show usage for all accounts
  F10                           Switch to another account

Smart Features:
  - Auto-selects account with most remaining quota
  - Detects rate limits and switches to another account
  - Syncs conversations so you can resume on any account
  - MCP servers synced from master folder to all accounts
  - Warns before a login expires, and signs lapsed accounts in on launch
  - Each account logs in through its own Chrome profile (no claude.ai switching)

Examples:
  hub                                  # Auto-select best account and run
  hub --account work                   # Force specific account
  hub --add-account personal           # Add a new account called "personal"
  hub --rename-account main cc1        # Rename "main" to "cc1"
  hub --no-auto-switch                 # Disable auto-switch on rate limit
  hub --resume abc123                  # Auto-select and resume conversation
  hub mcp add codex -- npx -y codex-mcp-server  # Add MCP server
`);
}

/**
 * Run sync and return summary stats
 */
function runSync(config: ReturnType<typeof loadConfig>, verbose: boolean): SyncSummary {
  const conversations = syncConversations(config, verbose);
  if (verbose) console.log('');

  const history = syncHistory(config, verbose);
  if (verbose) console.log('');

  const extensions = syncExtensions(config, verbose);
  if (verbose) console.log('');

  const mcp = syncMcp(config, verbose);
  if (verbose) console.log('');

  if (verbose) {
    console.log('✓ Sync complete');
  }

  return {
    conversations,
    history,
    extensions,
    mcp,
  };
}

/**
 * Launch Claude with PTY wrapper for rate limit detection and command interception
 */
function launchClaudeWithPty(
  config: ReturnType<typeof loadConfig>,
  accountName: string,
  claudeArgs: string[],
  usageData: APIUsageData[],
  autoSwitch: boolean,
  verbose: boolean
): void {
  const accountPath = config.accounts[accountName];

  if (!accountPath) {
    console.error(`Error: Account '${accountName}' not found in config`);
    console.error(`Available accounts: ${Object.keys(config.accounts).join(', ')}`);
    process.exit(1);
  }

  // Build environment. BROWSER points at this account's Chrome profile, so a
  // /login typed mid-session opens the browser already signed in as this
  // account instead of whichever one claude.ai happens to be showing.
  const env = buildAuthEnv(accountName, accountPath, config);

  // Register this session for multi-terminal awareness
  registerSession(accountName);

  // Clean up session on exit
  const cleanupSession = () => unregisterSession();
  process.on('exit', cleanupSession);
  process.on('SIGINT', () => { cleanupSession(); process.exit(0); });
  process.on('SIGTERM', () => { cleanupSession(); process.exit(0); });

  // Track if we're handling an intentional switch (don't exit on kill)
  let isHandlingRateLimit = false;
  let isHandlingManualSwitch = false;

  // Variable to hold wrapper reference for command context
  let wrapper: ReturnType<typeof createPtyWrapper>;

  // Create command context for hub commands
  const createCommandContext = (): CommandContext => ({
    accountName,
    accounts: config.accounts,
    usageData,
    pauseOutput: () => wrapper?.pauseOutput(),
    resumeOutput: () => wrapper?.resumeOutput(),
    setInputHandler: (handler) => wrapper?.setCommandInputHandler(handler),
    triggerRedraw: () => wrapper?.triggerRedraw(),
    switchAccount: (newAccountName: string, resumeSession: boolean) => {
      // Mark that we're switching (don't exit on kill)
      isHandlingManualSwitch = true;

      // Find session ID BEFORE killing/syncing (sync changes mtimes!)
      let sessionId: string | null = null;
      if (resumeSession) {
        sessionId = findActiveSessionId(accountPath);
      }

      // Kill current Claude process
      wrapper.kill();

      console.log('');
      console.log(`⚡ Switching to ${newAccountName}...`);

      // Sync conversations so new account has this session
      console.log('   Syncing conversations...');
      syncConversations(config, false);
      syncHistory(config, false);
      console.log('   ✓ Sync complete');

      // Build resume args with session ID found earlier
      let resumeArgs = claudeArgs;
      if (sessionId) {
        // Filter out any existing --resume args
        const filteredArgs = claudeArgs.filter((a, i) => {
          if (a === '--resume') return false;
          if (i > 0 && claudeArgs[i - 1] === '--resume') return false;
          return true;
        });
        resumeArgs = ['--resume', sessionId, ...filteredArgs];
        console.log(`   Resuming session: ${sessionId.slice(0, 8)}...`);
      }

      // Get usage for new account
      const newUsage = usageData.find(u => u.accountName === newAccountName);
      const usedPct = newUsage ? newUsage.fiveHourUsed : '?';
      console.log(`   Launching with ${newAccountName} (${usedPct}% used)`);
      console.log('');

      // Launch with new account
      launchClaudeWithPty(config, newAccountName, resumeArgs, usageData, autoSwitch, verbose);
    },
  });

  wrapper = createPtyWrapper({
    command: 'claude',
    args: claudeArgs,
    env,
    cwd: process.cwd(),

    // Login lapsed mid-session
    onLoginExpired: () => {
      const where = isChromeAvailable()
        ? ` (opens Chrome profile "${resolveProfileDirectory(accountName, config)}")`
        : '';
      console.log('');
      console.log(`⚠ ${accountName}'s login expired — type /login to renew it${where}.`);
      console.log('');
    },

    // F9: Show usage
    onF9: async () => {
      const context = createCommandContext();
      const result = await executeCommand('/hub', context);
      if (result.message) {
        console.log(result.message);
      }
    },

    // F10: Switch account (placeholder for Phase 3)
    onF10: async () => {
      const context = createCommandContext();
      const result = await executeCommand('/switch', context);
      if (result.message) {
        console.log(result.message);
      }
    },

    onRateLimitDetected: () => {
      if (!autoSwitch || isHandlingRateLimit) {
        return;
      }

      isHandlingRateLimit = true;

      // Find next available account
      const nextAccount = selectNextAccount(usageData, accountName);

      if (!nextAccount || nextAccount.isRateLimited) {
        // No available accounts
        console.log('\n');
        console.log('⚠️  All accounts are rate-limited.');
        if (nextAccount?.resetsAt) {
          console.log(`   Soonest reset: ${nextAccount.accountName} in ${formatResetTime(nextAccount.resetsAt)}`);
        }
        console.log('   Waiting for rate limit options...');
        return;
      }

      // Kill current process
      wrapper.kill();

      console.log('\n');
      console.log(`⚡ Rate limit hit on ${accountName}. Switching to ${nextAccount.accountName}...`);

      // Sync conversations so new account has this session
      console.log('   Syncing conversations...');
      syncConversations(config, false);
      syncHistory(config, false);
      console.log('   ✓ Sync complete');

      // Find session ID to resume
      const sessionId = findActiveSessionId(accountPath);
      let resumeArgs = claudeArgs;
      if (sessionId) {
        const filteredArgs = claudeArgs.filter((a, i) => {
          if (a === '--resume') return false;
          if (i > 0 && claudeArgs[i - 1] === '--resume') return false;
          return true;
        });
        resumeArgs = ['--resume', sessionId, ...filteredArgs];
      }

      if (sessionId) {
        console.log(`   Resuming session: ${sessionId.slice(0, 8)}...`);
      }

      console.log(`   Launching with ${nextAccount.accountName} (${100 - nextAccount.sessionRemaining}% used)`);
      console.log('');

      // Launch with new account (recursive call with updated usage data)
      // Update usage data to reflect current account is now rate-limited
      const updatedUsage = usageData.map(u =>
        u.accountName === accountName
          ? { ...u, fiveHourRemaining: 0, fiveHourUsed: 100 }
          : u
      );

      launchClaudeWithPty(config, nextAccount.accountName, resumeArgs, updatedUsage, autoSwitch, verbose);
    },
    onExit: (code) => {
      // Don't exit if we're switching accounts (new Claude will launch)
      if (isHandlingRateLimit || isHandlingManualSwitch) {
        return;
      }
      cleanupTerminal();
      process.exit(code);
    },
  });

  // Handle errors (e.g., PTY spawn failed)
  wrapper.on('error', (err: Error) => {
    console.error('PTY Error:', err.message);
    console.log('Falling back to standard mode (auto-switch disabled)...');
    cleanupTerminal();

    // Fallback to regular spawn without PTY
    launchClaudeFallback(config, accountName, claudeArgs);
  });
}

/**
 * Fallback launch without PTY (no auto-switch capability)
 */
function launchClaudeFallback(
  config: ReturnType<typeof loadConfig>,
  accountName: string,
  claudeArgs: string[]
): void {
  const accountPath = config.accounts[accountName];

  const homeDir = os.homedir();
  const defaultClaudeDir = `${homeDir}/.claude`;
  const needsConfigDir = accountPath !== defaultClaudeDir;

  const env = { ...process.env };
  if (needsConfigDir) {
    env.CLAUDE_CONFIG_DIR = accountPath;
  }

  const child = spawn('claude', claudeArgs, {
    env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('Error launching Claude:', error.message);
    console.error('Make sure "claude" is installed and available in your PATH');
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  try {
    // Check if config exists - run setup wizard if not
    if (!configExists()) {
      const setupResult = await runSetupWizard();

      if (!setupResult) {
        // User cancelled setup
        process.exit(0);
      }

      // Save the config
      saveSetupConfig(setupResult, getConfigPath());
      return;
    }

    const config = loadConfig();

    // Handle --add-account first (before validation, since we might have no accounts yet)
    if (args.addAccount) {
      const success = await addAccount(args.addAccount, config);
      process.exit(success ? 0 : 1);
    }

    // Handle --rename-account
    if (args.renameAccount) {
      const success = handleRenameAccount(args.renameAccount.oldName, args.renameAccount.newName, config);
      process.exit(success ? 0 : 1);
    }

    if (!validateConfig(config)) {
      console.error('Configuration validation failed');
      process.exit(1);
    }

    // MCP subcommand
    if (args.mcpArgs) {
      const { handleMcpCommand } = await import('./mcp/commands');
      handleMcpCommand(args.mcpArgs, config, args.verbose);
      return;
    }

    // Login subcommand
    if (args.loginArgs) {
      const success = await handleLoginCommand(args.loginArgs, config);
      process.exit(success ? 0 : 1);
    }

    // Debug mode: list conversations
    if (args.list) {
      listConversations(config);
      return;
    }

    // Usage display mode
    if (args.usage) {
      console.log('Fetching usage from Anthropic API...');
      console.log('');
      const usages = await getAllAPIUsage(config.accounts);
      displayAPIUsage(usages, getAllLoginStatus(config.accounts));
      return;
    }

    // Score breakdown mode (for debugging/tuning)
    if (args.score) {
      console.log('Fetching usage and calculating scores...');
      console.log('');
      const usages = await getAllAPIUsage(config.accounts);
      const breakdowns = getScoreBreakdown(usages);
      const configVals = getConfigValues();

      // Display configuration
      console.log('=== Configuration ===');
      console.log(`  Base Score = sessionRemaining × ${configVals.WEIGHT_SESSION} + weeklyRemaining × ${configVals.WEIGHT_WEEKLY}`);
      console.log(`  Penalties: activeSession = -${configVals.PENALTY_ACTIVE_SESSION}, lastUsed = -${configVals.PENALTY_LAST_USED}`);
      console.log(`  Session Reset Bonus: up to +${configVals.MAX_SESSION_RESET_HOURS_FOR_BONUS * configVals.BONUS_PER_HOUR_CLOSER_SESSION_RESET} (${configVals.BONUS_PER_HOUR_CLOSER_SESSION_RESET}/hour closer)`);
      console.log(`  Weekly Reset Bonus: up to +${configVals.MAX_WEEKLY_RESET_DAYS_FOR_BONUS * configVals.BONUS_PER_DAY_CLOSER_WEEKLY_RESET} (${configVals.BONUS_PER_DAY_CLOSER_WEEKLY_RESET}/day closer)`);
      console.log('');

      // Display score breakdown for each account
      console.log('=== Score Breakdown ===');
      for (const b of breakdowns) {
        const marker = b.isBest ? ' ← BEST' : (b.isRateLimited ? ' (rate-limited)' : '');
        console.log(`${b.accountName}${marker}`);
        console.log(`  Usage: ${100 - b.sessionRemaining}% session (resets ${b.sessionResetsIn}), ${100 - b.weeklyRemaining}% weekly (resets ${b.weeklyResetsIn})`);
        console.log(`  Base Score:          ${b.baseScore.toFixed(1)} = ${b.sessionRemaining}×0.6 + ${b.weeklyRemaining}×0.4`);
        console.log(`  + Session Reset:     +${b.sessionResetBonus.toFixed(1)}`);
        console.log(`  + Weekly Reset:      +${b.weeklyResetBonus.toFixed(1)}`);
        if (b.activeSessionPenalty > 0) {
          console.log(`  - Active Session:    -${b.activeSessionPenalty}`);
        }
        if (b.lastUsedPenalty > 0) {
          console.log(`  - Last Used:         -${b.lastUsedPenalty}`);
        }
        console.log(`  ─────────────────────────`);
        console.log(`  Final Score:         ${b.finalScore.toFixed(1)}`);
        console.log('');
      }

      return;
    }

    // Sync-only mode
    if (args.sync) {
      const syncSummary = runSync(config, true); // Always verbose in sync-only mode
      if (!args.verbose) {
        console.log('✓ Sync complete');
      }
      return;
    }

    // Determine account to use
    let accountToUse = args.account;
    let usageData: APIUsageData[] = [];
    let selectedUsage: APIUsageData | null = null;

    if (!accountToUse) {
      // Auto-select best account
      if (args.verbose) {
        console.log('Checking account usage...');
      }
      usageData = await getAllAPIUsage(config.accounts);

      let selection = selectBestAccount(usageData);

      // Every account unusable is usually every account signed out — sign one
      // in rather than dead-ending on an error.
      if (!selection) {
        const signedOut = getAllLoginStatus(config.accounts).filter(s => needsLogin(s.state));

        if (signedOut.length === 0) {
          console.error('Error: No accounts available');
          process.exit(1);
        }

        console.log(`No account has a valid login (${signedOut.map(s => s.accountName).join(', ')}).`);
        console.log('');

        if (!await runLogin(signedOut[0].accountName, config)) {
          process.exit(1);
        }
        console.log('');

        clearUsageCache();
        usageData = await getAllAPIUsage(config.accounts);
        selection = selectBestAccount(usageData);

        if (!selection) {
          console.error('Error: No accounts available');
          process.exit(1);
        }
      }

      if (selection.isRateLimited && args.verbose) {
        console.log(`⚠️  All accounts are rate-limited.`);
        console.log(`   Using ${selection.accountName} (resets in ${formatResetTime(selection.resetsAt!)})`);
      } else if (args.verbose) {
        const usedPct = 100 - selection.sessionRemaining;
        console.log(`Selected: ${selection.accountName} (${usedPct}% used)`);
      }

      accountToUse = selection.accountName;
      selectedUsage = usageData.find(u => u.accountName === accountToUse) || null;

      if (args.verbose) {
        console.log('');
      }
    } else {
      // User specified account, but still fetch usage for auto-switch
      if (!args.noAutoSwitch) {
        usageData = await getAllAPIUsage(config.accounts);
        selectedUsage = usageData.find(u => u.accountName === accountToUse) || null;
      }
    }

    // Verify account exists
    if (!config.accounts[accountToUse]) {
      console.error(`Error: Account '${accountToUse}' not found in config`);
      console.error(`Available accounts: ${Object.keys(config.accounts).join(', ')}`);
      process.exit(1);
    }

    // Deal with the login before starting a session: sign in if it has lapsed,
    // or offer to renew if it's about to. Both beat being interrupted mid-task.
    let loginStatus: LoginStatus = getLoginStatus(accountToUse, config.accounts[accountToUse]);
    let loginChanged = false;

    if (needsLogin(loginStatus.state)) {
      console.log(`${accountToUse} is signed out — signing in first.`);
      console.log('');

      if (!await runLogin(accountToUse, config)) {
        process.exit(1);
      }
      console.log('');
      loginChanged = true;
    } else if (loginStatus.state === 'expiring') {
      loginChanged = await offerRenewal(loginStatus, config);
    }

    if (loginChanged) {
      loginStatus = getLoginStatus(accountToUse, config.accounts[accountToUse]);
      clearUsageCache();
      usageData = await getAllAPIUsage(config.accounts);
      selectedUsage = usageData.find(u => u.accountName === accountToUse) || null;
    }

    // Auto-sync if enabled
    let syncSummary: SyncSummary | null = null;
    if (config.syncOnStart) {
      syncSummary = runSync(config, args.verbose);
      if (args.verbose) {
        console.log('');
      }
    }

    // Launch Claude
    const isWindows = process.platform === 'win32';
    // Auto-switch needs node-pty output scanning, which we skip on Windows to
    // keep native scrollback/selection. F10 is the Windows manual switch.
    const autoSwitch = !args.noAutoSwitch && usageData.length > 0 && !isWindows;

    // Display compact startup box (unless verbose mode which already showed details)
    if (!args.verbose) {
      const allLoginStatuses = getAllLoginStatus(config.accounts);
      renderStartupBox(
        accountToUse,
        selectedUsage,
        syncSummary,
        autoSwitch,
        loginStatus,
        allLoginStatuses
      );
      console.log('');
    } else {
      // Verbose mode: show traditional launch message
      if (autoSwitch) {
        console.log(`Launching Claude with ${accountToUse} (auto-switch enabled)`);
      } else {
        console.log(`Launching Claude with ${accountToUse}`);
        if (args.noAutoSwitch) {
          console.log('(auto-switch disabled)');
        }
      }
      console.log('');
    }

    if (isWindows) {
      // Direct-attach launch (native scrollback/selection); see launch/windows.ts.
      launchClaudeWindows(config, accountToUse, args.claudeArgs, usageData, args.verbose);
    } else if (autoSwitch) {
      launchClaudeWithPty(config, accountToUse, args.claudeArgs, usageData, true, args.verbose);
    } else {
      launchClaudeFallback(config, accountToUse, args.claudeArgs);
    }

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
