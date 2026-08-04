/**
 * `hub login` — sign an account in, in its own browser profile
 *
 * A claude.ai login lasts ~30 days from the moment you sign in, and using the
 * account does NOT extend it (refreshing the access token renews nothing). A
 * fresh login is the only thing that resets the clock — so `hub login` doubles
 * as "renew", and works on a healthy account as readily as a signed-out one.
 *
 * The painful part was never the login itself: claude.ai can only be signed
 * into one account per browser profile, so renewing account B meant logging
 * account A out first. Each account gets a Chrome profile named after it (see
 * browser.ts), so the browser is already the right person when it opens.
 *
 * Delegates the actual OAuth to `claude auth login` — hub never touches tokens
 * itself, because refresh tokens are single-use and rotating one outside the
 * CLI permanently breaks the login.
 */

import { spawnSync } from 'child_process';
import * as readline from 'readline';
import { Config } from '../config';
import { platform } from '../platform';
import { loadState, saveState } from '../usage/selector';
import { buildAuthEnv, resolveProfileDirectory, isChromeAvailable } from './browser';
import {
  getLoginStatus,
  getAllLoginStatus,
  describeLoginStatus,
  needsLogin,
  LoginStatus,
} from './status';

/**
 * Handle `hub login [account]`.
 *
 * With no account, lists every account's login status.
 * @returns true on success
 */
export async function handleLoginCommand(args: string[], config: Config): Promise<boolean> {
  const accountName = args[0];

  if (!accountName || accountName === '--list' || accountName === '-l') {
    showLoginStatusTable(config);
    return true;
  }

  if (accountName === '--help' || accountName === '-h') {
    showLoginHelp();
    return true;
  }

  if (!config.accounts[accountName]) {
    console.error(`Account '${accountName}' not found in config`);
    console.error(`Available accounts: ${Object.keys(config.accounts).join(', ')}`);
    return false;
  }

  return runLogin(accountName, config);
}

/**
 * Sign an account in (or renew a login that still has time left).
 */
export async function runLogin(accountName: string, config: Config): Promise<boolean> {
  const configDir = config.accounts[accountName];
  const before = getLoginStatus(accountName, configDir);
  const profile = resolveProfileDirectory(accountName, config);

  const verb = needsLogin(before.state) ? 'Signing in' : 'Renewing';
  console.log(`${verb} ${accountName}${before.emailAddress ? ` (${before.emailAddress})` : ''}...`);

  if (isChromeAvailable()) {
    console.log(`  Browser: Chrome profile "${profile}"`);
    console.log(`  Sign in as: ${before.emailAddress ?? accountName}`);
    console.log('');
    console.log('  Finish the sign-in inside that Chrome window — if claude.ai emails');
    console.log('  you a link, open it in that same window, not your usual browser.');
  } else {
    console.log('  Browser: system default (Chrome not found)');
  }
  console.log('');

  // Deliberately no --email: prefilling auto-submits the address on claude.ai and
  // drops you straight into the emailed-verification-code flow, hiding the
  // "Continue with Google" button. Left alone, a profile signed into the right
  // Google account signs in with one click. The account and address are printed
  // above, so there's no ambiguity about who to sign in as.
  const result = spawnSync('claude', ['auth', 'login'], {
    stdio: 'inherit',
    env: buildAuthEnv(accountName, configDir, config),
  });

  if (result.error) {
    console.error(`Failed to run claude: ${result.error.message}`);
    console.error('Make sure claude is installed and in your PATH.');
    return false;
  }

  console.log('');

  const after = getLoginStatus(accountName, configDir);
  if (needsLogin(after.state)) {
    console.error(`✗ ${accountName} is still signed out.`);
    return false;
  }

  clearRenewalPrompt(accountName);

  // Tidy up the "Sign in" / "Sign in successful" tabs the flow leaves behind
  if (isChromeAvailable()) {
    platform.closeLoginTabs();
  }

  if (after.daysLeft !== undefined) {
    const moved = before.daysLeft !== undefined && after.daysLeft > before.daysLeft
      ? ` (was ${before.daysLeft})`
      : '';
    console.log(`✓ ${accountName} signed in — valid for ${after.daysLeft} days${moved}`);
  } else {
    console.log(`✓ ${accountName} signed in`);
  }
  return true;
}

/**
 * Offer to renew a login that's close to expiring.
 *
 * Asks at most once a day per account so it doesn't nag, and never blocks a
 * non-interactive run.
 * @returns true if the account was renewed
 */
export async function offerRenewal(status: LoginStatus, config: Config): Promise<boolean> {
  if (status.state !== 'expiring' || !process.stdin.isTTY) {
    return false;
  }
  if (promptedToday(status.accountName)) {
    return false;
  }

  markRenewalPrompted(status.accountName);

  console.log(`${status.accountName}'s ${describeLoginStatus(status)}.`);
  const renew = await promptYesNo('Renew it now?', false);
  console.log('');

  if (!renew) {
    console.log(`Skipping — renew later with: hub login ${status.accountName}`);
    console.log('');
    return false;
  }

  return runLogin(status.accountName, config);
}

/** Print a table of every account's login state */
export function showLoginStatusTable(config: Config): void {
  const statuses = getAllLoginStatus(config.accounts);

  console.log('Claude Hub Logins');
  console.log('');

  const nameWidth = Math.max(...statuses.map(s => s.accountName.length), 4);
  const emailWidth = Math.max(...statuses.map(s => (s.emailAddress ?? '').length), 5);

  for (const status of statuses) {
    const marker = needsLogin(status.state) ? '✗' : status.state === 'expiring' ? '!' : '✓';
    const email = (status.emailAddress ?? '').padEnd(emailWidth);
    const profile = resolveProfileDirectory(status.accountName, config);

    console.log(
      `  ${marker} ${status.accountName.padEnd(nameWidth)}  ${email}  ` +
      `${stateLabel(status).padEnd(22)}  Chrome: ${profile}`
    );
  }

  console.log('');

  const stale = statuses.filter(s => needsLogin(s.state) || s.state === 'expiring');
  if (stale.length > 0) {
    console.log(`Renew with: ${stale.map(s => `hub login ${s.accountName}`).join(', ')}`);
  } else {
    console.log('All logins healthy. Renew any time with: hub login <account>');
  }
}

function stateLabel(status: LoginStatus): string {
  switch (status.state) {
    case 'logged-out':
      return 'logged out';
    case 'expired':
      return 'login expired';
    case 'expiring':
    case 'ok':
      return status.daysLeft === undefined
        ? 'signed in'
        : `${status.daysLeft} days left`;
    case 'unknown':
      return 'unknown';
  }
}

// ============================================================================
// Renewal prompt throttling
// ============================================================================

function promptedToday(accountName: string): boolean {
  const last = loadState().renewalPromptedAt?.[accountName];
  if (!last) return false;
  return new Date(last).toDateString() === new Date().toDateString();
}

function markRenewalPrompted(accountName: string): void {
  try {
    const state = loadState();
    saveState({
      ...state,
      renewalPromptedAt: { ...state.renewalPromptedAt, [accountName]: new Date().toISOString() },
    });
  } catch {
    // Throttling is a nicety; never fail a login over it
  }
}

function clearRenewalPrompt(accountName: string): void {
  try {
    const state = loadState();
    if (!state.renewalPromptedAt?.[accountName]) return;

    const remaining = { ...state.renewalPromptedAt };
    delete remaining[accountName];
    saveState({ ...state, renewalPromptedAt: remaining });
  } catch {
    // Same — best effort
  }
}

// ============================================================================
// Prompts
// ============================================================================

function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = (await promptLine(`${question} ${hint}: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

function showLoginHelp(): void {
  console.log(`
Claude Hub - Account Login

Usage:
  hub login                     Show login status for all accounts
  hub login <account>           Sign in or renew an account

A claude.ai login lasts about 30 days and using it does not extend that window,
so each account needs signing in again roughly monthly. Signing in again is the
only thing that resets the clock, so run this on a healthy account whenever you
want to push its expiry out.

Hub warns you when a login is within 5 days of expiring, offers to renew it at
launch, and signs an account in automatically if you start one that has already
lapsed.

Each account signs in through a Chrome profile named after it (cc2 uses Chrome
profile "cc2"), created on first use. That way claude.ai stays signed in as the
right account per profile, and you never have to log one account out to use
another — including for a /login typed mid-session.

To point an account at a Chrome profile you already have, add it to config.json:

  "chromeProfiles": { "cc2": "Profile 2" }
`);
}
