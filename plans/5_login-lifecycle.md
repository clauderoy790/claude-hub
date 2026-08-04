# Plan 5: Login Lifecycle

Make multi-account logins painless: stop hub from killing idle accounts' logins,
surface upcoming expiry, and make re-login a one-step flow that lands in the right
browser profile.

## Background

Anthropic changed OAuth behaviour in mid-2026:

- **Access token**: ~8h lifetime, refreshed silently by the CLI when within 5 minutes
  of expiry. Unchanged, not a problem.
- **Refresh token**: now carries `refreshTokenExpiresAt` (~30 days, anchored at
  `/login` — refreshing does **not** extend it). When it lapses, or when a refresh
  returns `invalid_grant`, Claude Code **blanks the stored credential in place**
  (`accessToken: ""`, `refreshToken: ""`, `expiresAt: 0`) and requires `/login`.

Two consequences for hub:

1. A login must be renewed roughly monthly per account. Unavoidable; the CLI warns
   3 days ahead (docs: *Renew an expiring login*). Hub should surface the same signal.
2. Refresh tokens are single-use and rotate. Any third party that refreshes them
   outside the CLI can desync and permanently kill the login — see
   [CodexBar #1161](https://github.com/steipete/CodexBar/issues/1161), whose fix was
   "never call the OAuth refresh endpoint on CLI-owned tokens; delegate to `claude`".
   **hub currently does exactly the dangerous thing**: `usage/api.ts` spawns `claude`
   for every idle account on every launch and kills it after 30s, which can lose a
   rotated token mid-flight.

Observed on this machine: cc2 was wiped 8 days into a 30-day window; cc3 and cc4 are
wiped too. cc1 (the account in daily use) is healthy.

## Phases

### Phase 1: Stop killing idle logins

- Delete `refreshToken()` from `src/usage/api.ts` and its call site in the 401 path.
  Hub never refreshes; only `claude` does, during a session it owns.
- On 401, return a plain `token expired` error instead of spawning anything.
- Distinguish the blanked-credential state in `platform/mac.ts` and
  `platform/windows.ts`: an empty `accessToken` means logged out, not "not found".
  Keep the existing "OAuth token not found" message for a genuinely absent field so
  current tests still pass.

### Phase 2: Surface login expiry

- New `src/auth/status.ts`: `getLoginStatus(configDir)` reads the credential and
  returns `{ state: 'ok' | 'expiring' | 'expired' | 'logged-out', daysLeft, expiresAt }`,
  where `expiring` means `refreshTokenExpiresAt` is within `WARN_DAYS` (5).
- Show it in three places:
  - startup box (`display/startup.ts`) — a line for the launched account, plus a
    roll-up when other accounts need attention;
  - F9 overlay (`commands/hub.ts`);
  - `hub --usage` (`usage/apiDisplay.ts`).
- Accounts with a dead login already fall out of auto-selection
  (`selector.ts:328` filters `!u.error`), so no selector change is needed.

### Phase 3: `hub login` with per-account browser profiles

- `src/auth/browser.ts`: write a small wrapper script that opens a URL in a specific
  Chrome profile, and expose its path. Claude Code launches the browser by spawning
  `$BROWSER <url>`, so pointing `BROWSER` at the wrapper redirects the whole flow.
- **Profile name = account name**, always. Chrome accepts an arbitrary
  `--profile-directory` value and creates the directory on first use (verified against
  an isolated `--user-data-dir`), so `cc2` uses a profile literally named `cc2`. No
  prompt, no setup, and the profile is self-describing in Chrome's switcher — unlike
  Chrome's own `Default` / `Profile 1` / "Person 1" names, which say nothing about
  which account they hold.
- Optional `chromeProfiles: Record<accountName, profileDirectory>` in config overrides
  it, for pointing an account at a profile that already exists.
- If Chrome isn't installed, leave `BROWSER` unset and fall back to the system default
  browser. That's a detected condition, not a user-facing choice.
- `src/auth/login.ts`: `hub login <account>` runs `claude auth login` with
  `CLAUDE_CONFIG_DIR` and `BROWSER` set, stdio inherited, then reports the new expiry.
  Deliberately does **not** pass `--email`: prefilling auto-submits the address on
  claude.ai and forces the emailed-verification-code path, hiding "Continue with
  Google". A profile signed into the matching Google account then signs in with one
  click. The terminal prints which account and address to use instead.
- The emailed sign-in link only works in the profile that started the login (the
  pending session lives in that profile's cookies), so the login output says so.
- After a successful login, close the leftover "Sign in" / "Sign in successful" tabs
  via AppleScript (`platform.closeLoginTabs()`), then quit Chrome if no windows remain.
  Zero-windows is the safety test: someone who actually browses in Chrome still has
  windows, so their browser survives; someone who only has Chrome open because hub
  opened it gets it closed. Matches only OAuth-flow URLs so an ordinary Claude tab is
  never touched, and fails silently if automation permission is refused. No equivalent
  on Windows, where the tabs stay.
- `hub login` with no argument lists every account: state, email, days left, profile.

### Phase 4: Automatic login on launch, renewal, and mid-session

- Before launching claude, if the target account's login is `expired`/`logged-out`,
  sign in inline and then continue into the session — no error, no second command. If
  auto-selection finds no healthy account, offer login for one.
- If the login is `expiring` (within `WARN_DAYS`), offer to renew it at launch. A fresh
  login re-anchors the 30-day window, so this is the only way to avoid being
  interrupted mid-task. Asked at most once a day per account (tracked in the existing
  `~/.claude-hub/state.json`), and skipped entirely when stdin isn't a TTY.
- Always launch claude with `BROWSER` set to the account's profile wrapper, so a
  `/login` typed **mid-session** also lands in the right profile with no detection
  needed.
- Add a `Login expired` trigger next to `RATE_LIMIT_TRIGGER` in `pty/wrapper.ts` that
  prints a one-line hint telling the user to type `/login`.

## Testing

Build first: `npm run build && npm link`.

1. **Status surfacing** — `hub login` lists all accounts with days left and profile;
   `hub --usage` shows `logged out` instead of a raw error. Both return instantly,
   which is the proof nothing spawns `claude` any more.
2. **No more force-refresh** — `grep -rn "spawnSync" src/usage/` returns nothing.
3. **Sign in a dead account** — `hub login cc2` opens a new Chrome profile named
   `cc2` with no prompts. Sign into claude.ai there as claude.roy791@gmail.com;
   expect `✓ cc2 signed in — valid for ~30 days`.
4. **Renew a healthy account** — `hub login cc1` (still valid) should re-login
   without a logout first and push its expiry out, printing `(was N)`.
5. **Auto-login on launch** — `hub --account cc3` (still logged out) goes straight
   into the login flow, then into a Claude session.
6. **Mid-session `/login`** — inside a `hub --account cc2` session, type `/login` and
   confirm it opens the `cc2` Chrome profile, not the default one.
7. **Regression** — `npm test`; `hub` with no args still auto-selects and launches.
