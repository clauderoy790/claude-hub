/**
 * F10: Switch Account Command - Switch to another account without exiting Claude
 *
 * Uses alternate screen buffer to display account selection menu.
 * When account selected: kills current Claude, syncs, and relaunches with new account.
 */

import { registerCommand, CommandHandler, CommandContext } from './handler';
import { APIUsageData, getAllAPIUsage, hasValidUsageCache, selectBestAccount } from '../usage';

// ANSI escape sequences
const ESC = '\x1b';
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const CURSOR_HOME = `${ESC}[H`;
const CLEAR_SCREEN = `${ESC}[2J`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const CYAN = `${ESC}[36m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;

/**
 * Generate a progress bar string
 */
function progressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format time until reset
 */
function formatResetTime(resetDate: Date): string {
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  // If reset time is in the past, data is stale (show indicator)
  if (diffMs <= 0) return 'just reset';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}


interface SwitchOption {
  number: number;
  accountName: string;
  isRecommended: boolean;
}

/**
 * Render the switch account menu
 */
function renderSwitchMenu(
  usages: APIUsageData[],
  currentAccount: string
): SwitchOption[] {
  const bestSelection = selectBestAccount(usages, currentAccount);
  const bestAccount = bestSelection?.accountName ?? null;
  const options: SwitchOption[] = [];
  let optionNumber = 1;

  // Title
  process.stdout.write(`${BOLD}${CYAN}Switch Account${RESET}\n\n`);

  for (const usage of usages) {
    const isCurrent = usage.accountName === currentAccount;
    const isBest = usage.accountName === bestAccount;

    // Build suffix indicators
    let suffix = '';
    if (isCurrent) {
      suffix = `  ${DIM}<- current${RESET}`;
    } else if (isBest) {
      suffix = `  ${GREEN}(best)${RESET}`;
    }

    // Account name line
    let nameDisplay = usage.accountName;
    if (usage.emailAddress) {
      const emailUser = usage.emailAddress.split('@')[0];
      nameDisplay = `${usage.accountName} ${DIM}(${emailUser})${RESET}`;
    }

    process.stdout.write(`${BOLD}${nameDisplay}${RESET}${suffix}\n`);

    if (usage.error) {
      process.stdout.write(`  ${DIM}Error: ${usage.error}${RESET}\n`);
    } else {
      // Session line
      const sessionBar = progressBar(usage.fiveHourUsed);
      const sessionPct = `${usage.fiveHourUsed}%`.padStart(4);
      const sessionReset = formatResetTime(usage.fiveHourResetsAt);
      process.stdout.write(`  Session  ${sessionBar}  ${sessionPct}  resets in ${sessionReset}\n`);

      // Weekly line
      const weeklyBar = progressBar(usage.sevenDayUsed);
      const weeklyPct = `${usage.sevenDayUsed}%`.padStart(4);
      const weeklyReset = formatResetTime(usage.sevenDayResetsAt);
      process.stdout.write(`  Weekly   ${weeklyBar}  ${weeklyPct}  resets in ${weeklyReset}\n`);
    }

    // Track as option if not current account
    if (!isCurrent) {
      options.push({
        number: optionNumber,
        accountName: usage.accountName,
        isRecommended: isBest,
      });
      optionNumber++;
    }

    process.stdout.write('\n');
  }

  // Options footer
  if (options.length > 0) {
    for (const opt of options) {
      const label = opt.isRecommended
        ? `${GREEN}[${opt.number}] ${opt.accountName} (recommended)${RESET}`
        : `[${opt.number}] ${opt.accountName}`;
      process.stdout.write(`${label}\n`);
    }
    process.stdout.write(`${DIM}[Esc] Cancel${RESET}\n`);
    process.stdout.write('\n');
    process.stdout.write(`${DIM}Press 1-${options.length} to switch, Esc to cancel${RESET}\n`);
  } else {
    process.stdout.write(`${YELLOW}No other accounts available${RESET}\n`);
    process.stdout.write(`${DIM}Press any key to return${RESET}\n`);
  }

  return options;
}

/**
 * Wait for user selection
 * Returns: selected option number (1-based), or null for cancel
 */
function waitForSelection(
  context: CommandContext,
  maxOption: number
): Promise<number | null> {
  return new Promise((resolve) => {
    context.setInputHandler((data: string) => {
      for (const char of data) {
        // Esc = cancel
        if (char === '\x1b') {
          context.setInputHandler(null);
          resolve(null);
          return;
        }

        // If no options, any key cancels
        if (maxOption === 0) {
          context.setInputHandler(null);
          resolve(null);
          return;
        }

        // Number = select
        const num = parseInt(char, 10);
        if (num >= 1 && num <= maxOption) {
          context.setInputHandler(null);
          resolve(num);
          return;
        }
      }
    });
  });
}

/**
 * F10 switch command handler
 *
 * Shows account selection menu and switches to selected account.
 * Uses alternate screen buffer to preserve Claude's display.
 */
const switchHandler: CommandHandler = async (_args, context) => {
  // Check if switchAccount callback is available
  if (!context.switchAccount) {
    process.stdout.write('\n');
    process.stdout.write('Switch command not available in this mode.\n');
    process.stdout.write('Exit Claude and run: hub --account <name>\n');
    process.stdout.write('\n');
    return { handled: true, suppress: true };
  }

  // Pause Claude output while we display
  context.pauseOutput();

  let selectedAccount: string | null = null;

  try {
    // Switch to alternate screen buffer
    process.stdout.write(ALT_SCREEN_ON);
    process.stdout.write(CLEAR_SCREEN);
    process.stdout.write(CURSOR_HOME);

    // Fetch usage data (uses cache if fresh, otherwise fetches)
    if (!hasValidUsageCache()) {
      process.stdout.write('Fetching usage...\n');
    }
    const usages = await getAllAPIUsage(context.accounts);
    process.stdout.write(CLEAR_SCREEN);
    process.stdout.write(CURSOR_HOME);

    // Render menu and get options
    const options = renderSwitchMenu(usages, context.accountName);

    // Wait for selection
    const selection = await waitForSelection(context, options.length);

    if (selection !== null) {
      selectedAccount = options[selection - 1].accountName;
    }

  } finally {
    // Move cursor to home before switching back (ghost cursor fix)
    process.stdout.write(CURSOR_HOME);

    // Switch back to main screen buffer
    process.stdout.write(ALT_SCREEN_OFF);

    // Resume Claude output
    context.resumeOutput();
  }

  // If account was selected, trigger the switch
  if (selectedAccount) {
    // Small delay to let alternate screen switch complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Trigger account switch (this will kill current Claude and relaunch)
    context.switchAccount(selectedAccount, true);
  }

  return { handled: true, suppress: true };
};

// Register the command
registerCommand('switch', switchHandler);

export { switchHandler };
