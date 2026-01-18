/**
 * /hub Command - Display usage for all accounts
 *
 * Uses alternate screen buffer to avoid corrupting Claude's TUI.
 * Shows usage table, waits for Esc to return to Claude.
 */

import { registerCommand, CommandHandler } from './handler';
import { getAllAPIUsage, APIUsageData, hasValidUsageCache, selectBestAccount } from '../usage';

// ANSI escape sequences
const ESC = '\x1b';
const ALT_SCREEN_ON = `${ESC}[?1049h`;   // Switch to alternate screen buffer
const ALT_SCREEN_OFF = `${ESC}[?1049l`;  // Switch back to main screen
const CURSOR_HOME = `${ESC}[H`;          // Move cursor to top-left
const CLEAR_SCREEN = `${ESC}[2J`;        // Clear entire screen
const DIM = `${ESC}[2m`;                 // Dim text
const RESET = `${ESC}[0m`;               // Reset formatting
const BOLD = `${ESC}[1m`;                // Bold text
const CYAN = `${ESC}[36m`;               // Cyan text

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


/**
 * Render usage display (simple format without box to avoid alignment issues)
 */
function renderUsageDisplay(
  usages: APIUsageData[],
  currentAccount: string
): void {
  const bestSelection = selectBestAccount(usages);
  const bestAccount = bestSelection?.accountName ?? null;

  // Title
  process.stdout.write(`${BOLD}${CYAN}Hub Usage${RESET}\n\n`);

  for (const usage of usages) {
    const isCurrent = usage.accountName === currentAccount;
    const isBest = usage.accountName === bestAccount && !isCurrent;

    // Build suffix indicators
    let suffix = '';
    if (isCurrent) suffix = `  ${DIM}<- current${RESET}`;
    else if (isBest) suffix = `  ${DIM}(best)${RESET}`;

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

    process.stdout.write('\n');
  }

  // Footer
  process.stdout.write(`${DIM}Press any key to return${RESET}\n`);
}

/**
 * Wait for any key press using the command input handler
 */
function waitForAnyKey(context: { setInputHandler: (handler: ((data: string) => void) | null) => void }): Promise<void> {
  return new Promise((resolve) => {
    const onInput = (_data: string) => {
      // Any key dismisses the display
      context.setInputHandler(null);
      resolve();
    };

    context.setInputHandler(onInput);
  });
}

/**
 * /hub command handler
 *
 * Fetches and displays usage for all accounts.
 * Uses alternate screen buffer to preserve Claude's display.
 */
const hubHandler: CommandHandler = async (args, context) => {
  // Handle help
  if (args === '--help' || args === '-h' || args === '?') {
    // For help, just print inline (don't use alternate screen)
    process.stdout.write('\n');
    process.stdout.write('/hub - Show usage for all Claude accounts\n');
    process.stdout.write('\n');
    process.stdout.write('Usage: /hub\n');
    process.stdout.write('\n');
    process.stdout.write('Displays session and weekly usage percentages\n');
    process.stdout.write('for all configured accounts.\n');
    process.stdout.write('Press Esc or q to return to Claude.\n');
    process.stdout.write('\n');
    return { handled: true, suppress: true };
  }

  // Pause Claude output while we display
  context.pauseOutput();

  try {
    // Switch to alternate screen buffer - this saves and isolates the main screen
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

    // Render usage
    renderUsageDisplay(usages, context.accountName);

    // Wait for any key to dismiss
    await waitForAnyKey(context);

  } finally {
    // Move cursor to home before switching back (may help with ghost cursor)
    process.stdout.write(CURSOR_HOME);

    // Switch back to main screen buffer - this restores Claude's display
    process.stdout.write(ALT_SCREEN_OFF);

    // Resume Claude output
    context.resumeOutput();
  }

  return { handled: true, suppress: true };
};

// Register the command
registerCommand('hub', hubHandler);

export { hubHandler };
