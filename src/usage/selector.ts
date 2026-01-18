/**
 * Account Selector - Smart account selection based on usage data
 *
 * Selects the best account considering:
 * - Session/weekly usage remaining (from API)
 * - Active sessions (avoid stacking terminals on same account)
 * - Last used account (spread usage when scores are close)
 * - Reset times (prefer accounts resetting sooner when tied)
 */

import * as fs from 'fs';
import * as path from 'path';
import { APIUsageData } from './api';

// =============================================================================
// CONFIGURATION - Adjust these values to tune account selection behavior
// =============================================================================

/** Weight for session (5-hour) remaining percentage in base score (0-1) */
export const WEIGHT_SESSION = 0.6;

/** Weight for weekly (7-day) remaining percentage in base score (0-1) */
export const WEIGHT_WEEKLY = 0.4;

/** Score penalty for accounts with an active session (-points) */
export const PENALTY_ACTIVE_SESSION = 15;

/** Score penalty for the last used account (-points) */
export const PENALTY_LAST_USED = 5;

/** Bonus per hour closer to SESSION reset (5-hour window) */
export const BONUS_PER_HOUR_CLOSER_SESSION_RESET = 0.5;

/** Maximum hours to consider for session reset bonus (caps the bonus) */
export const MAX_SESSION_RESET_HOURS_FOR_BONUS = 24;

/** Bonus per day closer to WEEKLY reset (7-day window) - prioritizes "use it or lose it" capacity */
export const BONUS_PER_DAY_CLOSER_WEEKLY_RESET = 2.5;

/** Maximum days to consider for weekly reset bonus (caps the bonus at 7 days) */
export const MAX_WEEKLY_RESET_DAYS_FOR_BONUS = 7;

/** Score difference threshold to consider accounts "similar" for tiebreaking (points) */
export const SIMILAR_SCORE_THRESHOLD = 10;

/** State file location */
export const STATE_FILE_PATH = path.join(
  process.env.HOME || '~',
  '.claude-hub',
  'state.json'
);

// =============================================================================
// TYPES
// =============================================================================

export interface AccountSelection {
  accountName: string;
  sessionRemaining: number;
  weeklyRemaining: number;
  score: number;
  isRateLimited: boolean;
  resetsAt?: Date;
}

export interface ActiveSession {
  account: string;
  pid: number;
  startedAt: string;
}

export interface SelectorState {
  lastUsedAccount: string | null;
  lastUsedAt: string | null;
  activeSessions: ActiveSession[];
}

interface ScoredAccount {
  usage: APIUsageData;
  baseScore: number;
  adjustedScore: number;
  penalties: string[]; // For debugging/logging
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

/**
 * Load selector state from file, returns empty state if file doesn't exist
 */
export function loadState(): SelectorState {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const content = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors, return default state
  }
  return {
    lastUsedAccount: null,
    lastUsedAt: null,
    activeSessions: [],
  };
}

/**
 * Save selector state to file
 */
export function saveState(state: SelectorState): void {
  try {
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Ignore errors - state is nice-to-have, not critical
  }
}

/**
 * Check if a process is still running by PID
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up stale sessions (processes that are no longer running)
 */
export function cleanStaleSessions(state: SelectorState): SelectorState {
  const activeSessions = state.activeSessions.filter(session =>
    isProcessRunning(session.pid)
  );
  return { ...state, activeSessions };
}

/**
 * Register current process as using an account
 */
export function registerSession(accountName: string): void {
  const state = cleanStaleSessions(loadState());

  // Remove any existing session for this PID (in case of restart)
  state.activeSessions = state.activeSessions.filter(s => s.pid !== process.pid);

  // Add new session
  state.activeSessions.push({
    account: accountName,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  // Update last used
  state.lastUsedAccount = accountName;
  state.lastUsedAt = new Date().toISOString();

  saveState(state);
}

/**
 * Unregister current process session (call on exit)
 */
export function unregisterSession(): void {
  const state = loadState();
  state.activeSessions = state.activeSessions.filter(s => s.pid !== process.pid);
  saveState(state);
}

/**
 * Get list of accounts with active sessions (after cleaning stale ones)
 */
function getActiveAccounts(state: SelectorState): Set<string> {
  return new Set(state.activeSessions.map(s => s.account));
}

// =============================================================================
// SCORING LOGIC
// =============================================================================

/**
 * Calculate hours until a date
 */
function hoursUntil(date: Date): number {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60));
}

/**
 * Calculate days until a date
 */
function daysUntil(date: Date): number {
  return hoursUntil(date) / 24;
}

/**
 * Calculate base score from usage data (higher = more capacity available)
 */
function calculateBaseScore(usage: APIUsageData): number {
  return (usage.fiveHourRemaining * WEIGHT_SESSION) +
         (usage.sevenDayRemaining * WEIGHT_WEEKLY);
}

/**
 * Calculate SESSION reset bonus (5-hour window)
 * Accounts with session resetting sooner get a small bonus.
 * This helps use up capacity before it resets.
 */
function calculateSessionResetBonus(usage: APIUsageData): number {
  const hoursToReset = hoursUntil(usage.fiveHourResetsAt);
  const cappedHours = Math.min(hoursToReset, MAX_SESSION_RESET_HOURS_FOR_BONUS);
  // Inverse: fewer hours = higher bonus (max ~12 points at 0 hours)
  return (MAX_SESSION_RESET_HOURS_FOR_BONUS - cappedHours) * BONUS_PER_HOUR_CLOSER_SESSION_RESET;
}

/**
 * Calculate WEEKLY reset bonus (7-day window)
 * Accounts with weekly reset coming sooner get a significant bonus.
 *
 * Rationale: "Use it or lose it" - capacity that resets sooner is more urgent.
 * An account with 57% remaining but resetting in 3 days is more urgent than
 * an account with 79% remaining but resetting in 6 days.
 *
 * Example with BONUS_PER_DAY_CLOSER_WEEKLY_RESET = 2.5:
 * - Account resetting in 3 days: (7-3) × 2.5 = +10 points
 * - Account resetting in 6 days: (7-6) × 2.5 = +2.5 points
 */
function calculateWeeklyResetBonus(usage: APIUsageData): number {
  const daysToReset = daysUntil(usage.sevenDayResetsAt);
  const cappedDays = Math.min(daysToReset, MAX_WEEKLY_RESET_DAYS_FOR_BONUS);
  // Inverse: fewer days = higher bonus (max ~17.5 points at 0 days)
  return (MAX_WEEKLY_RESET_DAYS_FOR_BONUS - cappedDays) * BONUS_PER_DAY_CLOSER_WEEKLY_RESET;
}

/**
 * Score all accounts with penalties and bonuses applied
 */
function scoreAccounts(
  usages: APIUsageData[],
  state: SelectorState,
  excludeAccount?: string
): ScoredAccount[] {
  const activeAccounts = getActiveAccounts(state);

  return usages
    .filter(u => !u.error && u.accountName !== excludeAccount)
    .map(usage => {
      const baseScore = calculateBaseScore(usage);
      let adjustedScore = baseScore;
      const penalties: string[] = [];

      // Penalty for active session on this account
      if (activeAccounts.has(usage.accountName)) {
        adjustedScore -= PENALTY_ACTIVE_SESSION;
        penalties.push(`active session: -${PENALTY_ACTIVE_SESSION}`);
      }

      // Penalty for last used account
      if (usage.accountName === state.lastUsedAccount) {
        adjustedScore -= PENALTY_LAST_USED;
        penalties.push(`last used: -${PENALTY_LAST_USED}`);
      }

      // Session reset bonus (prefer accounts whose session resets sooner)
      const sessionResetBonus = calculateSessionResetBonus(usage);
      adjustedScore += sessionResetBonus;
      if (sessionResetBonus > 0) {
        penalties.push(`session reset bonus: +${sessionResetBonus.toFixed(1)}`);
      }

      // Weekly reset bonus (prefer accounts whose weekly resets sooner - "use it or lose it")
      const weeklyResetBonus = calculateWeeklyResetBonus(usage);
      adjustedScore += weeklyResetBonus;
      if (weeklyResetBonus > 0) {
        penalties.push(`weekly reset bonus: +${weeklyResetBonus.toFixed(1)}`);
      }

      return { usage, baseScore, adjustedScore, penalties };
    });
}

// =============================================================================
// MAIN SELECTION FUNCTION
// =============================================================================

/**
 * Select the best account based on usage data and session state
 *
 * Algorithm:
 * 1. Filter out accounts with errors or 0% session remaining
 * 2. Calculate base score: sessionRemaining × 0.6 + weeklyRemaining × 0.4
 * 3. Apply penalties:
 *    - Active session: -15 points (avoid stacking terminals)
 *    - Last used: -5 points (encourage round-robin)
 * 4. Apply bonuses:
 *    - Session reset bonus: up to +12 points for accounts resetting sooner
 *    - Weekly reset bonus: up to +17.5 points for accounts with weekly reset sooner
 *      (this implements "use it or lose it" - prioritizes capacity that expires soon)
 * 5. Pick highest adjusted score
 *
 * If all accounts are rate-limited, picks the one with soonest reset.
 *
 * @param usages - Array of usage data for all accounts
 * @param excludeAccount - Optional account to exclude (e.g., current account)
 * @returns Best account selection, or null if no accounts available
 */
export function selectBestAccount(
  usages: APIUsageData[],
  excludeAccount?: string
): AccountSelection | null {
  if (usages.length === 0) {
    return null;
  }

  // Load and clean state
  const state = cleanStaleSessions(loadState());

  // Filter candidates (no errors, not excluded)
  const candidates = usages.filter(
    u => !u.error && u.accountName !== excludeAccount
  );

  if (candidates.length === 0) {
    return null;
  }

  // Separate available (has session remaining) from rate-limited
  const available = candidates.filter(u => u.fiveHourRemaining > 0);
  const rateLimited = candidates.filter(u => u.fiveHourRemaining <= 0);

  // If all rate-limited, pick soonest reset
  if (available.length === 0) {
    const sorted = rateLimited.sort((a, b) =>
      a.fiveHourResetsAt.getTime() - b.fiveHourResetsAt.getTime()
    );
    const best = sorted[0];
    return {
      accountName: best.accountName,
      sessionRemaining: best.fiveHourRemaining,
      weeklyRemaining: best.sevenDayRemaining,
      score: 0,
      isRateLimited: true,
      resetsAt: best.fiveHourResetsAt,
    };
  }

  // Score available accounts
  const scored = scoreAccounts(available, state, excludeAccount);

  // Sort by adjusted score (highest first)
  scored.sort((a, b) => b.adjustedScore - a.adjustedScore);

  const best = scored[0];

  return {
    accountName: best.usage.accountName,
    sessionRemaining: best.usage.fiveHourRemaining,
    weeklyRemaining: best.usage.sevenDayRemaining,
    score: best.adjustedScore,
    isRateLimited: false,
  };
}

/**
 * Get the next best account after the current one hits a rate limit
 */
export function selectNextAccount(
  usages: APIUsageData[],
  currentAccount: string
): AccountSelection | null {
  return selectBestAccount(usages, currentAccount);
}

/**
 * Check if an account is rate-limited based on usage data
 */
export function isAccountRateLimited(usage: APIUsageData): boolean {
  return !usage.error && usage.fiveHourRemaining <= 0;
}

/**
 * Format reset time for display
 */
export function formatResetTime(resetDate: Date): string {
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  // If reset time is in the past, data may be stale
  if (diffMs <= 0) return 'just reset';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// =============================================================================
// DEBUG / SCORING BREAKDOWN
// =============================================================================

export interface ScoreBreakdown {
  accountName: string;
  sessionRemaining: number;
  weeklyRemaining: number;
  sessionResetsIn: string;
  weeklyResetsIn: string;
  baseScore: number;
  sessionResetBonus: number;
  weeklyResetBonus: number;
  activeSessionPenalty: number;
  lastUsedPenalty: number;
  finalScore: number;
  isRateLimited: boolean;
  isBest: boolean;
}

/**
 * Get detailed scoring breakdown for all accounts (for debugging/tuning)
 */
export function getScoreBreakdown(usages: APIUsageData[]): ScoreBreakdown[] {
  const state = cleanStaleSessions(loadState());
  const activeAccounts = getActiveAccounts(state);

  // Score all accounts (including rate-limited for display)
  const breakdowns: ScoreBreakdown[] = usages
    .filter(u => !u.error)
    .map(usage => {
      const baseScore = calculateBaseScore(usage);
      const sessionResetBonus = calculateSessionResetBonus(usage);
      const weeklyResetBonus = calculateWeeklyResetBonus(usage);
      const activeSessionPenalty = activeAccounts.has(usage.accountName) ? PENALTY_ACTIVE_SESSION : 0;
      const lastUsedPenalty = usage.accountName === state.lastUsedAccount ? PENALTY_LAST_USED : 0;

      const isRateLimited = usage.fiveHourRemaining <= 0;
      const finalScore = isRateLimited
        ? 0
        : baseScore + sessionResetBonus + weeklyResetBonus - activeSessionPenalty - lastUsedPenalty;

      return {
        accountName: usage.accountName,
        sessionRemaining: usage.fiveHourRemaining,
        weeklyRemaining: usage.sevenDayRemaining,
        sessionResetsIn: formatResetTime(usage.fiveHourResetsAt),
        weeklyResetsIn: formatResetTime(usage.sevenDayResetsAt),
        baseScore: Math.round(baseScore * 10) / 10,
        sessionResetBonus: Math.round(sessionResetBonus * 10) / 10,
        weeklyResetBonus: Math.round(weeklyResetBonus * 10) / 10,
        activeSessionPenalty,
        lastUsedPenalty,
        finalScore: Math.round(finalScore * 10) / 10,
        isRateLimited,
        isBest: false, // Will be set below
      };
    });

  // Sort by final score and mark the best
  breakdowns.sort((a, b) => b.finalScore - a.finalScore);
  if (breakdowns.length > 0 && !breakdowns[0].isRateLimited) {
    breakdowns[0].isBest = true;
  }

  return breakdowns;
}

/**
 * Get current configuration values (for display)
 */
export function getConfigValues(): Record<string, number> {
  return {
    WEIGHT_SESSION,
    WEIGHT_WEEKLY,
    PENALTY_ACTIVE_SESSION,
    PENALTY_LAST_USED,
    BONUS_PER_HOUR_CLOSER_SESSION_RESET,
    MAX_SESSION_RESET_HOURS_FOR_BONUS,
    BONUS_PER_DAY_CLOSER_WEEKLY_RESET,
    MAX_WEEKLY_RESET_DAYS_FOR_BONUS,
  };
}
