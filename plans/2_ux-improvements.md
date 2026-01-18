# Plan 2: UX Improvements - Compact Output & In-Session Shortcuts

## Overview

Improve the user experience of Claude Hub with:
1. Simplified, compact startup output
2. Consistent "used" percentages (matching Claude's `/usage`)
3. In-session keyboard shortcuts (F9/F10) for usage and switching

## Goals

- Reduce visual clutter on startup
- Make it immediately clear which account is active and its usage
- Allow switching accounts without exiting Claude
- Show usage across all accounts from within a session

## Important: Why Function Keys Instead of Slash Commands

Initially, we tried intercepting `/hub` and `/switch` commands. This approach failed because:
1. Characters typed are forwarded to Claude immediately (showing autocomplete)
2. Complex line buffering required to hold back input
3. State sync issues between our buffer and Claude's TUI
4. After using Claude's own `/commands`, our interception broke

**Solution:** Use function keys (F9, F10) which are:
- Single escape sequences (easy to detect)
- Not used by Claude
- No buffering or state management needed
- Work reliably in any state

See `docs/explanations/alternate-screen-buffer.md` for technical details.

---

## Phase 1: Compact Startup Output

### Context
Currently, `hub` shows verbose sync output (20+ lines). Users want a compact summary.

### Tasks

1. **Create compact display function** (`src/display/startup.ts`)
   - Render a compact box with:
     - Account name and usage bar
     - Sync status (single line)
     - Auto-switch indicator

   Target output:
   ```
   ┌─ Hub ──────────────────────────────────────┐
   │ account2  ░░░░░░░░░░  0% used | ⏱ 4h 18m  │
   │           ████░░░░░░ 35% week | ⏱ 2d 1h   │
   │ ✓ synced (2 changes) • auto-switch on      │
   └────────────────────────────────────────────┘
   ```

2. **Update sync functions to return summary stats**
   - Modify `syncConversations()` to return `{ copied, updated, skipped }`
   - Modify `syncHistory()` to return `{ totalEntries }`
   - Modify `syncExtensions()` to return `{ copied, updated, removed }`

3. **Update main CLI to use compact output**
   - Replace verbose sync output with single-line summary
   - Only show details with `-v` flag

4. **Change percentages from "remaining" to "used"**
   - Update `selectBestAccount()` display text
   - Update all user-facing messages

### Files to Create/Modify
```
src/display/startup.ts     # New - compact startup display
src/display/index.ts       # New - exports
src/sync/conversations.ts  # Modify - return stats
src/sync/history.ts        # Modify - return stats
src/sync/extensions.ts     # Modify - return stats
src/index.ts               # Modify - use compact output
```

### Success Criteria
- Startup shows compact box (≤5 lines)
- Verbose mode (`-v`) shows full sync details
- Percentages show "used" not "remaining"

### Manual Testing
```bash
# Compact output (default)
hub
# Should show compact box, then Claude launches

# Verbose output
hub -v
# Should show detailed sync info like before

# Check percentage wording
hub --usage
# Should show "X% used" not "X% remaining"
```

---

## Phase 2: Function Key Shortcuts & Usage Overlay (COMPLETED)

### Context
The PTY wrapper currently monitors output for rate limits. Extend it to intercept function keys (F9, F10) for in-session commands.

### Prerequisites
- Phase 1 complete
- PTY wrapper working (from Plan 1, Phase 6)

### Implementation Summary

1. **Function key detection in PTY wrapper** (`src/pty/wrapper.ts`)
   - Detect F9 (`\x1b[20~`) and F10 (`\x1b[21~`) escape sequences
   - Buffer input briefly to detect multi-byte sequences
   - Call registered handlers when detected
   - Forward all other input to Claude unchanged

2. **Command handler module** (`src/commands/handler.ts`)
   - Registry pattern for command handlers
   - `CommandContext` interface with: accountName, accounts, usageData, pauseOutput, resumeOutput, setInputHandler, triggerRedraw

3. **F9: Usage overlay** (`src/commands/hub.ts`)
   - Uses **alternate screen buffer** to preserve Claude's display
   - Key technique to avoid ghost cursor:
     ```typescript
     // IMPORTANT: Move cursor to home BEFORE switching back
     process.stdout.write('\x1b[H');      // Cursor to (0,0)
     process.stdout.write('\x1b[?1049l'); // Then switch back
     ```
   - Waits for any key to dismiss
   - See `docs/explanations/alternate-screen-buffer.md`

4. **Startup display updated** (`src/display/startup.ts`)
   - Shows "F9: usage | F10: switch" in the box

### Files Created/Modified
```
src/pty/wrapper.ts          # Modified - F9/F10 detection, triggerRedraw()
src/commands/handler.ts     # New - command routing, CommandContext
src/commands/hub.ts         # New - F9 usage overlay
src/commands/switch.ts      # New - F10 placeholder
src/commands/index.ts       # New - exports
src/display/startup.ts      # Modified - show shortcuts
src/index.ts                # Modified - wire up F9/F10 handlers
docs/explanations/alternate-screen-buffer.md  # New - technical explanation
```

### Success Criteria (All Met)
- F9 shows usage overlay without corrupting Claude's display
- Press any key returns cleanly to Claude
- No ghost cursor after returning
- Works repeatedly without state issues

### Manual Testing
```bash
hub
# Once Claude is running:
# Press F9 to see usage overlay
# Press any key to return to Claude
# Verify no ghost cursor, display is clean
# Press F9 again - should work repeatedly
```

---

## Phase 3: Switch Account Implementation (F10)

### Context
Implement F10 shortcut to switch accounts without exiting Claude.

### Prerequisites
- Phase 2 complete (F9 usage overlay working)
- Understand alternate screen buffer technique (see `docs/explanations/alternate-screen-buffer.md`)

### Tasks

1. **Implement F10 switch overlay** (`src/commands/switch.ts`)

   Display an account selection menu using **alternate screen buffer** (same technique as F9):

   ```
   Switch Account

   main (user@example.com)  <- current
     Session  ██████████░░░░░░░░░░  30%  resets in 2h 55m
     Weekly   ███░░░░░░░░░░░░░░░░░  15%  resets in 6d 16h

   account2 (user2@example.com)  (best)
     Session  ██████████████░░░░░░  67%  resets in 2h 55m
     Weekly   ████████░░░░░░░░░░░░  38%  resets in 3d 17h

   [1] account2 (recommended)
   [Esc] Cancel

   Press 1 to switch, Esc to cancel
   ```

2. **Handle user input in overlay**
   - Use `context.setInputHandler()` to receive keypresses (same as F9)
   - Number keys (1, 2, etc.) → select account
   - Esc → cancel and return to Claude
   - Any other key → ignore

3. **Implement switch execution** (when account selected)

   The switch needs to:
   ```typescript
   // 1. Exit alternate screen first
   process.stdout.write('\x1b[H');      // Cursor home (ghost cursor fix)
   process.stdout.write('\x1b[?1049l'); // Exit alternate screen
   context.resumeOutput();

   // 2. Get the PTY wrapper to kill Claude and relaunch
   // Add switchAccount callback to CommandContext:
   context.switchAccount(targetAccountName);
   ```

4. **Implement switchAccount in index.ts**
   ```typescript
   // In createCommandContext():
   switchAccount: (newAccountName: string) => {
     // Kill current Claude process
     wrapper.kill();

     // Sync conversations so new account has this session
     syncConversations(config, false);
     syncHistory(config, false);

     // Find session ID to resume
     const sessionId = findActiveSessionId(config.accounts[accountName]);
     const resumeArgs = sessionId
       ? ['--resume', sessionId, ...claudeArgs]
       : claudeArgs;

     // Launch with new account
     launchClaudeWithPty(config, newAccountName, resumeArgs, usageData, autoSwitch, verbose);
   }
   ```

5. **Handle edge cases**
   - Switching to current account → show "Already on this account" message, don't switch
   - All accounts rate-limited → show reset times, allow selection anyway
   - Account has errors → show error, allow other selections

### Key Implementation Notes

**Use the same alternate screen buffer pattern as F9:**
```typescript
// Enter overlay
context.pauseOutput();
process.stdout.write('\x1b[?1049h'); // Alternate screen ON
process.stdout.write('\x1b[2J');     // Clear
process.stdout.write('\x1b[H');      // Cursor home

// ... render menu, handle input ...

// Exit overlay (IMPORTANT: cursor home first!)
process.stdout.write('\x1b[H');      // Cursor home BEFORE switching
process.stdout.write('\x1b[?1049l'); // Alternate screen OFF
context.resumeOutput();
```

**Input handling pattern (from F9):**
```typescript
function waitForSelection(context, accountCount): Promise<number | null> {
  return new Promise((resolve) => {
    context.setInputHandler((data: string) => {
      for (const char of data) {
        // Esc = cancel
        if (char === '\x1b') {
          context.setInputHandler(null);
          resolve(null);
          return;
        }
        // Number = select
        const num = parseInt(char, 10);
        if (num >= 1 && num <= accountCount) {
          context.setInputHandler(null);
          resolve(num);
          return;
        }
      }
    });
  });
}
```

### Files to Create/Modify
```
src/commands/switch.ts      # Modify - full implementation (currently placeholder)
src/commands/handler.ts     # Already has switchAccount in interface
src/index.ts                # Add switchAccount to createCommandContext()
```

### Success Criteria
- F10 shows account selection overlay
- Number keys select accounts
- Esc cancels and returns to Claude cleanly
- Selected account launches with session resumed
- No ghost cursor issues (same fix as F9)

### Manual Testing
```bash
hub
# Once Claude is running:

# Test menu display
# Press F10
# Should show account list with usage

# Test cancel
# Press Esc
# Should return to Claude cleanly (no ghost cursor)

# Test switch
# Press F10, then press 1 (or 2)
# Should switch to that account
# Session should resume

# Test current account
# If on main, and main is option 1, pressing 1 should show "Already on main"
```

---

## Phase 4: Polish & Documentation (COMPLETED)

### Context
Final polish, edge case handling, and documentation updates.

### Prerequisites
- Phase 3 complete

### Tasks

1. **Error handling improvements**
   - Network errors when fetching usage → show cached data or error message
   - Process management edge cases (Claude crashes during switch)
   - Graceful degradation when PTY not available

2. **Loading indicators**
   - Show "Fetching usage..." while loading in overlays
   - Show "Switching to account2..." during account switch

3. **Update documentation**
   - README already has keyboard shortcuts section
   - Add screenshots of F9/F10 overlays
   - Ensure CLAUDE.md phase status is current

4. **Edge case handling in switch**
   - What if new account's Claude fails to launch? → Show error, stay on current
   - What if session file is corrupted? → Launch without --resume

### Files to Create/Modify
```
src/commands/switch.ts      # Error handling
src/commands/hub.ts         # Error handling
README.md                   # Add screenshots
CLAUDE.md                   # Update phase status
```

### Success Criteria
- Errors shown gracefully (not crashes)
- Loading states visible
- Documentation complete with visuals

### Manual Testing
```bash
# Test network error
# Disconnect network, then press F9
# Should show error or cached data

# Test rapid key presses
# Press F9, then immediately press F10
# Should handle gracefully

# Test switch failure
# (Hard to test - maybe mock a failure)
```

---

## Summary

| Phase | Description | Key Deliverable |
|-------|-------------|-----------------|
| 1 | Compact Startup Output | Clean startup box with shortcuts hint |
| 2 | F9 Usage Overlay | Full-screen usage with alternate screen buffer |
| 3 | F10 Switch Overlay | Account selection menu, session resume |
| 4 | Polish & Documentation | Error handling, loading states, docs |

## Technical Notes

### Why Function Keys Instead of Slash Commands
Slash command interception failed because:
- Characters forwarded to Claude show autocomplete
- Complex line buffering required
- State sync issues with Claude's TUI
- Broke after using Claude's own `/commands`

Function keys (F9, F10) work because:
- Single escape sequences (easy to detect)
- Not used by Claude
- No buffering needed
- Work reliably in any state

### Alternate Screen Buffer Pattern
All overlays use this pattern:
```typescript
// Enter overlay
context.pauseOutput();
process.stdout.write('\x1b[?1049h'); // Alternate screen ON
process.stdout.write('\x1b[2J\x1b[H'); // Clear + cursor home

// ... render content, wait for input ...

// Exit overlay (CRITICAL: cursor home first to avoid ghost cursor!)
process.stdout.write('\x1b[H');      // Cursor home
process.stdout.write('\x1b[?1049l'); // Alternate screen OFF
context.resumeOutput();
```

### Input Handling During Overlay
Use `context.setInputHandler()` to receive keypresses:
```typescript
context.setInputHandler((data: string) => {
  // Process each character
  for (const char of data) {
    if (char === '\x1b') { /* Esc pressed */ }
    if (char === '1') { /* 1 pressed */ }
  }
});
```

See `docs/explanations/alternate-screen-buffer.md` for full details.
