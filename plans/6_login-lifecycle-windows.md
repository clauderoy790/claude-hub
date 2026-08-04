# Plan 6: Login Lifecycle on Windows (investigation sketch)

**Status: not a plan yet.** Phase 0 answers four questions that decide what the
later phases should be. Do not implement Phases 1+ as written — rewrite them once
Phase 0 has real answers from a Windows machine.

## Context

[Plan 5](5_login-lifecycle.md) reworked login handling: hub stopped refreshing tokens,
started surfacing login expiry, added `hub login`, and gave each account its own Chrome
profile. It was built and verified on macOS only.

The underlying model is server-side and therefore identical on Windows: a claude.ai
login lasts ~30 days from `/login`, refreshing the access token does not extend it, and
a rejected refresh blanks the stored credential.

## What already works on Windows

Verified by unit tests and code inspection, not on a real Windows machine:

- Reading `refreshTokenExpiresAt` from `<configDir>/.credentials.json`
  (`platform/windows.ts`), including the blanked-credential "logged out" state.
- Not force-refreshing tokens — Plan 5 deleted that path outright.
- Status table, expiry warnings, `hub --usage`, auto sign-in, renewal prompt — all
  platform-neutral display and `readline` logic.
- Chrome profile naming and `%LOCALAPPDATA%\Google\Chrome\User Data` discovery.

## Already fixed (do not redo)

- `launch/windows.ts` now builds its environment with `buildAuthEnv()`, so `BROWSER`
  is set on Windows sessions. As a side effect this also fixes a latent path bug: the
  old check compared `accountPath` against `` `${homeDir}/.claude` `` with a forward
  slash, which never matches on Windows, so `CLAUDE_CONFIG_DIR` was set even for the
  default `~/.claude` account.
- `auth/login.ts` spawns `platform.resolveCommand('claude')` rather than the bare
  name, which Windows needs when `claude` is a `.cmd` shim.

## Known gap, probably won't fix

`platform.closeLoginTabs()` is a no-op on Windows. Chrome exposes no scripting
interface there comparable to AppleScript, and killing the Chrome process would take
every profile down with it. Leftover login tabs stay open. Revisit only if Phase 0
turns up a safe per-profile mechanism.

`mcp/commands.ts` still spawns bare `claude` in three places, the same latent shim
problem fixed in `auth/login.ts`. Worth folding into whatever phase touches Windows
spawning.

## Phase 0: Investigation

Each question needs an answer from an actual Windows machine before the later phases
can be written.

### Q1. Where does Claude Code store credentials on Windows? (blocking)

The macOS binary contains `setWindowsCredManagerAvailable` /
`isWindowsCredManagerAvailable` next to `secure_storage_credentials_write`,
`plaintext_fallback_used` and `primary_and_fallback_failed`. That reads like a layered
store — OS secure storage as primary, `.credentials.json` as fallback. If Windows
Credential Manager is primary on current versions, hub reads a stale or absent file and
**every** credential-derived feature is wrong, including usage display, which predates
Plan 5.

The [official docs](https://code.claude.com/docs/en/authentication) still document
`.credentials.json` for Windows, so this is unresolved.

- **How to answer:** on Windows, sign an account in, then run `hub login`. Sane
  days-left figures mean the file is authoritative. Accounts reported "logged out" that
  plainly work mean the credential lives elsewhere. Cross-check with
  `cmdkey /list | findstr /i claude` and inspect the `.credentials.json` mtime.
- **If Credential Manager is primary:** `platform/windows.ts` needs a reader for it
  (PowerShell, or a native module), with the file kept as fallback. That is the whole
  of Phase 1 and it blocks everything else.

### Q2. Does Claude Code on Windows honour `BROWSER`, and can it spawn a `.cmd`?

This is load-bearing for profile routing — without it, every account's login opens in
whatever browser session Windows defaults to, which is the exact problem Plan 5 set out
to fix.

`BROWSER` is read in platform-neutral code (`vS()?.browser ?? Z.BROWSER`), and the
spawn helper looks like execa, which resolves `.cmd` shims through cross-spawn. Both
are inferences from the **macOS** build — Bun strips other platforms from the bundle,
so the Windows code path was never actually inspected.

- **How to answer:** set `BROWSER` to `%USERPROFILE%\.claude-hub\browser\<account>\open-profile.cmd`
  and run `claude auth login`. Confirm the named Chrome profile opens.
- **If `.cmd` doesn't spawn:** try a `.bat`, or an `.exe` shim, or point `BROWSER`
  straight at `chrome.exe` with arguments if Claude Code passes them through.
- **If `BROWSER` is ignored entirely:** fall back to Claude Code's `browser` *setting*
  (`vS()?.browser`), which the same code reads first — that would mean writing it into
  each account's `settings.json` instead of using an env var.

### Q3. Does `hub login` survive the Windows console?

`claude auth login` is spawned with `stdio: 'inherit'` and prompts for a pasted code.
Confirm the flow is usable in Windows Terminal, and that hub's own `readline` prompts
(the renewal offer) behave with the function-key poller in `launch/keyPoller.ts`.

### Q4. Is the mid-session "login expired" hint worth having?

Windows uses the direct-attach launcher, which doesn't scan Claude's output, so the
`LOGIN_EXPIRED_TRIGGER` hint in `pty/wrapper.ts` never fires there. Decide whether it's
worth a different mechanism (e.g. checking expiry on session exit) or whether the
startup warning plus Claude Code's own in-session banner is enough. Probably enough.

## Provisional phases (rewrite after Phase 0)

### Phase 1: Credential storage — only if Q1 says Credential Manager
Read from Windows Credential Manager with `.credentials.json` as fallback, mirroring
how `platform/mac.ts` wraps `security`. Keep `getCredentials()`'s contract identical so
nothing above the platform layer changes.

### Phase 2: Browser routing — shaped by Q2
Either confirm the `.cmd` wrapper works and just test it, or switch to the mechanism Q2
identifies. Update `browserProfileScript()` in `platform/windows.ts` accordingly.

### Phase 3: Polish
Whatever Q3 and Q4 turn up, plus the `mcp/commands.ts` spawn cleanup.

## Testing (once phases exist)

Run the Plan 5 test list on Windows — sign-in, renewal of a healthy account,
auto-login on launch, mid-session `/login`, `hub --usage`, `npm test`. Add:

- An account pointing at the default `~/.claude` on Windows, to confirm the
  `CLAUDE_CONFIG_DIR` path fix behaves.
- Confirm leftover login tabs are the only cosmetic difference from macOS.
