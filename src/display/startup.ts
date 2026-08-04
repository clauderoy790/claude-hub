/**
 * Compact Startup Display
 *
 * Renders a minimal startup box showing:
 * - Account name and usage bar (session)
 * - Weekly usage bar
 * - Sync status (single line)
 * - Auto-switch indicator
 */

import { APIUsageData } from '../usage';
import { LoginStatus, describeLoginStatus, needsLogin } from '../auth/status';

export interface SyncSummary {
  conversations: { copied: number; updated: number; skipped: number };
  history: { entriesMerged: number };
  extensions: { copied: number; updated: number; deleted: number };
  mcp: { serversSynced: number; accountsUpdated: number };
}

// Box dimensions - using STRING length (not visual width)
// All lines must have the same string length for alignment
const BAR_WIDTH = 10;
const CONTENT_WIDTH = 33;  // String length of content (excluding borders)
const BORDER_WIDTH = CONTENT_WIDTH + 4;  // 37: "│ " + content + " │"

/**
 * Pad string to target STRING length (not visual width)
 */
function padToLength(str: string, targetLength: number): string {
  if (str.length >= targetLength) {
    return str.substring(0, targetLength);
  }
  return str + ' '.repeat(targetLength - str.length);
}

/**
 * Generate a progress bar string using Unicode block characters
 */
function progressBar(percentage: number, width: number = BAR_WIDTH): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format time until reset in fixed-width format
 */
function formatResetTime(resetDate: Date): string {
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs <= 0) return '   0m';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    // Format: "Xh XXm" - pad to 6 chars
    return `${hours}h ${minutes.toString().padStart(2, ' ')}m`;
  }
  return `  ${minutes.toString().padStart(2, ' ')}m`;
}

/**
 * Format weekly reset time (days + hours) in fixed-width format
 */
function formatWeeklyResetTime(resetDate: Date): string {
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs <= 0) return '   0h';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  if (days > 0) {
    // Format: "Xd XXh" - pad to 6 chars
    return `${days}d ${hours.toString().padStart(2, ' ')}h`;
  }
  return `  ${hours.toString().padStart(2, ' ')}h`;
}

/**
 * Build the sync status line
 */
function buildSyncLine(syncSummary: SyncSummary | null, autoSwitch: boolean): string {
  const parts: string[] = [];

  if (syncSummary) {
    const { conversations, extensions, mcp } = syncSummary;
    const totalChanges =
      conversations.copied + conversations.updated +
      extensions.copied + extensions.updated + extensions.deleted +
      mcp.accountsUpdated;

    if (totalChanges === 0) {
      parts.push('synced');
    } else {
      parts.push(`synced (${totalChanges})`);
    }
  } else {
    parts.push('sync off');
  }

  parts.push(autoSwitch ? 'auto-switch on' : 'auto-switch off');

  return parts.join(' | ');
}

/**
 * Render a single line with proper box borders
 */
function renderLine(content: string): void {
  const padded = padToLength(content, CONTENT_WIDTH);
  console.log(`│ ${padded} │`);
}

/**
 * Build the login warning line, if any.
 *
 * Shows the launched account's own expiry first (it's the one about to bite),
 * otherwise a roll-up of other accounts that need signing in.
 */
function buildLoginLine(
  accountName: string,
  loginStatus: LoginStatus | null,
  otherStatuses: LoginStatus[]
): string | null {
  if (loginStatus) {
    const description = describeLoginStatus(loginStatus);
    if (description && loginStatus.state !== 'unknown') {
      return `⚠ ${accountName} ${description}`;
    }
  }

  const stale = otherStatuses.filter(
    s => s.accountName !== accountName && (needsLogin(s.state) || s.state === 'expiring')
  );

  if (stale.length === 0) {
    return null;
  }
  if (stale.length === 1) {
    return `⚠ ${stale[0].accountName}: ${describeLoginStatus(stale[0])}`;
  }
  return `⚠ ${stale.length} accounts need login`;
}

/**
 * Render the compact startup box
 */
export function renderStartupBox(
  accountName: string,
  usage: APIUsageData | null,
  syncSummary: SyncSummary | null,
  autoSwitch: boolean,
  loginStatus: LoginStatus | null = null,
  allLoginStatuses: LoginStatus[] = []
): void {
  // Top border: ┌─ Hub ─────...─────┐
  // Must be BORDER_WIDTH chars total
  const topDashes = BORDER_WIDTH - 8;  // 7 for "┌─ Hub " + 1 for "┐"
  console.log('┌─ Hub ' + '─'.repeat(topDashes) + '┐');

  // Session usage line
  if (usage && !usage.error) {
    const bar = progressBar(usage.fiveHourUsed);
    const pct = `${usage.fiveHourUsed}%`.padStart(3);
    const reset = formatResetTime(usage.fiveHourResetsAt);
    renderLine(`${accountName.padEnd(4)} ${bar} ${pct} used | ${reset}`);

    // Weekly usage line
    const weekBar = progressBar(usage.sevenDayUsed);
    const weekPct = `${usage.sevenDayUsed}%`.padStart(3);
    const weekReset = formatWeeklyResetTime(usage.sevenDayResetsAt);
    renderLine(`     ${weekBar} ${weekPct} week | ${weekReset}`);
  } else if (usage?.error) {
    renderLine(`${accountName.padEnd(4)} (error: ${usage.error.slice(0, 28)})`);
  } else {
    renderLine(`${accountName.padEnd(4)} (usage unknown)`);
  }

  // Sync status line
  const syncLine = buildSyncLine(syncSummary, autoSwitch);
  renderLine(syncLine);

  // Login expiry warning (only when something needs attention)
  const loginLine = buildLoginLine(accountName, loginStatus, allLoginStatuses);
  if (loginLine) {
    renderLine(loginLine);
  }

  // Shortcuts line
  renderLine('F9: usage | F10: switch');

  // Bottom border: └─────...─────┘
  console.log('└' + '─'.repeat(BORDER_WIDTH - 2) + '┘');
}

/**
 * Display verbose sync details (for -v flag)
 */
export function displayVerboseSyncDetails(syncSummary: SyncSummary): void {
  const { conversations, history, extensions, mcp } = syncSummary;

  console.log('Sync details:');
  console.log(`  Conversations: ${conversations.copied} copied, ${conversations.updated} updated, ${conversations.skipped} skipped`);
  console.log(`  History: ${history.entriesMerged} unique entries`);
  console.log(`  Extensions: ${extensions.copied} copied, ${extensions.updated} updated, ${extensions.deleted} removed`);
  console.log(`  MCP: ${mcp.serversSynced} server(s), ${mcp.accountsUpdated} account(s) updated`);
}
