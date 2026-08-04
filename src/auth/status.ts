/**
 * Login Status
 *
 * Reports how much life is left in each account's claude.ai login.
 *
 * Anthropic gives a login a fixed lifetime (~30 days) recorded as
 * `refreshTokenExpiresAt` in the stored credential. Refreshing the access token
 * does NOT extend it — only a fresh `/login` does. When the window lapses, or a
 * refresh is rejected, Claude Code blanks the credential in place and the
 * account is logged out until someone signs in again.
 *
 * Hub only reads this state; it never refreshes anything itself.
 */

import { platform, LoggedOutError } from '../platform';
import { getAccountInfo } from '../usage/api';

/**
 * How many days ahead of expiry to start warning (Claude Code itself warns at 3).
 *
 * HUB_LOGIN_WARN_DAYS overrides it, which is mostly useful for exercising the
 * warning and renewal prompt without waiting for a login to actually age.
 */
export const WARN_DAYS = parsePositiveInt(process.env.HUB_LOGIN_WARN_DAYS) ?? 5;

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LoginState =
  | 'ok'          // healthy, expiry not near (or unknown)
  | 'expiring'    // login window closes within WARN_DAYS
  | 'expired'     // login window has closed
  | 'logged-out'  // credential blanked or absent
  | 'unknown';    // couldn't read the credential for another reason

export interface LoginStatus {
  accountName: string;
  state: LoginState;
  /** Whole days until the login expires (negative once past). Undefined if unknown. */
  daysLeft?: number;
  /** When the login expires, if the credential records it */
  expiresAt?: Date;
  /** Account email, when known */
  emailAddress?: string;
  /** Why the state is 'unknown' */
  error?: string;
}

/** True when this state needs the user to sign in again */
export function needsLogin(state: LoginState): boolean {
  return state === 'expired' || state === 'logged-out';
}

/**
 * Read the login status for a single account.
 *
 * Never throws — an unreadable credential comes back as 'unknown'.
 */
export function getLoginStatus(accountName: string, configDir: string): LoginStatus {
  const emailAddress = getAccountInfo(configDir)?.emailAddress;

  try {
    const credentials = platform.getCredentials(configDir);
    const expiresAtMs = credentials.claudeAiOauth.refreshTokenExpiresAt;

    // Older credentials predate the field. The login still works; we just
    // can't say how long for, so don't cry wolf.
    if (typeof expiresAtMs !== 'number' || expiresAtMs <= 0) {
      return { accountName, state: 'ok', emailAddress };
    }

    const msLeft = expiresAtMs - Date.now();
    const daysLeft = Math.ceil(msLeft / MS_PER_DAY);
    const expiresAt = new Date(expiresAtMs);

    if (msLeft <= 0) {
      return { accountName, state: 'expired', daysLeft, expiresAt, emailAddress };
    }
    if (msLeft <= WARN_DAYS * MS_PER_DAY) {
      return { accountName, state: 'expiring', daysLeft, expiresAt, emailAddress };
    }
    return { accountName, state: 'ok', daysLeft, expiresAt, emailAddress };
  } catch (err) {
    if (err instanceof LoggedOutError) {
      return { accountName, state: 'logged-out', emailAddress };
    }
    const message = err instanceof Error ? err.message : String(err);
    // "Not logged in" — no credential was ever stored for this config dir
    if (message.includes('Not logged in')) {
      return { accountName, state: 'logged-out', emailAddress };
    }
    return { accountName, state: 'unknown', emailAddress, error: message };
  }
}

/** Read login status for every configured account */
export function getAllLoginStatus(accounts: Record<string, string>): LoginStatus[] {
  return Object.entries(accounts).map(([name, configDir]) =>
    getLoginStatus(name, configDir)
  );
}

/**
 * Short human label, e.g. "login expires in 3 days" / "logged out".
 * Returns null when there's nothing worth saying.
 */
export function describeLoginStatus(status: LoginStatus): string | null {
  switch (status.state) {
    case 'logged-out':
      return 'logged out';
    case 'expired':
      return 'login expired';
    case 'expiring':
      return `login expires in ${formatDays(status.daysLeft)}`;
    case 'unknown':
      return 'login status unknown';
    case 'ok':
      return null;
  }
}

function formatDays(days: number | undefined): string {
  if (days === undefined) return 'soon';
  if (days <= 0) return 'less than a day';
  return days === 1 ? '1 day' : `${days} days`;
}
