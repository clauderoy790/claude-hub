/**
 * Display functions for API-based usage data
 *
 * Displays usage in a minimal, scannable format with progress bars
 * similar to Claude Code's native /usage command.
 */

import { APIUsageData } from './api';
import { selectBestAccount } from './selector';

/**
 * Generate a progress bar string
 *
 * @param percentage - Usage percentage (0-100)
 * @param width - Total width of the bar (default 10)
 * @returns Progress bar string like "█████░░░░░"
 */
function progressBar(percentage: number, width: number = 10): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Pad a string to a specific width
 */
function pad(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (str.length >= width) return str;
  const padding = ' '.repeat(width - str.length);
  return align === 'right' ? padding + str : str + padding;
}

/**
 * Format time until reset with hours and minutes
 */
function formatResetTime(resetDate: Date): string {
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs <= 0) return '0m';

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
 * Display API usage data in minimal format with progress bars
 *
 * Output format:
 * ```
 * Claude Hub Usage
 *
 * main (user@example.com)
 *   Session  █████████░  99% | ⏱ 1h 23m
 *   Weekly   █░░░░░░░░░  11% | ⏱ 6d 20h
 *
 * account2 (user2@example.com)  ← best
 *   Session  ░░░░░░░░░░   0% | ⏱ 1h 23m
 *   Weekly   ███░░░░░░░  28% | ⏱ 3d 21h
 * ```
 */
export function displayAPIUsage(usages: APIUsageData[]): void {
  if (usages.length === 0) {
    console.log('No accounts configured.');
    return;
  }

  // Find the best account
  const bestSelection = selectBestAccount(usages);
  const bestName = bestSelection?.accountName || '';

  console.log('Claude Hub Usage');
  console.log('');

  for (const usage of usages) {
    const isBest = usage.accountName === bestName;

    // Build account header
    let header = usage.accountName;
    if (usage.emailAddress) {
      const emailUser = usage.emailAddress.split('@')[0];
      header = `${usage.accountName} (${emailUser})`;
    }
    if (isBest) {
      header += '  ← best';
    }

    console.log(header);

    if (usage.error) {
      console.log(`  Error: ${usage.error}`);
    } else {
      // Session line
      const sessionBar = progressBar(usage.fiveHourUsed);
      const sessionPct = pad(`${usage.fiveHourUsed}%`, 4, 'right');
      const sessionReset = formatResetTime(usage.fiveHourResetsAt);
      console.log(`  Session  ${sessionBar}  ${sessionPct} | ⏱ ${sessionReset}`);

      // Weekly line
      const weeklyBar = progressBar(usage.sevenDayUsed);
      const weeklyPct = pad(`${usage.sevenDayUsed}%`, 4, 'right');
      const weeklyReset = formatResetTime(usage.sevenDayResetsAt);
      console.log(`  Weekly   ${weeklyBar}  ${weeklyPct} | ⏱ ${weeklyReset}`);
    }

    console.log('');
  }
}

/**
 * Display brief API usage summary (single line)
 */
export function displayBriefAPIUsage(usages: APIUsageData[]): void {
  const bestSelection = selectBestAccount(usages);
  if (!bestSelection) return;

  const best = usages.find(u => u.accountName === bestSelection.accountName);
  if (!best || best.error) return;

  if (bestSelection.sessionRemaining > 0) {
    console.log(`Best: ${best.accountName} (${best.fiveHourUsed}% session used, ${best.sevenDayUsed}% weekly used)`);
  } else {
    const resetTime = formatResetTime(best.fiveHourResetsAt);
    console.log(`All at limit. ${best.accountName} resets in ${resetTime}`);
  }
}

/**
 * Get the best account name for auto-selection
 */
export function getBestAccountName(usages: APIUsageData[]): string | null {
  const bestSelection = selectBestAccount(usages);
  return bestSelection?.accountName || null;
}
