# Alternate Screen Buffer & Ghost Cursor Fix

This document explains how the F9 usage overlay works and why moving the cursor to home position before switching back prevents the "ghost cursor" issue.

## The Problem

When displaying an overlay (like usage info) on top of Claude's TUI, we need to:
1. Show our content without destroying Claude's display
2. Return cleanly to Claude's display when done

## Solution: Alternate Screen Buffer

Terminals support two screen buffers:

```
┌─────────────────────────────────────────────────────────┐
│                    TERMINAL                             │
│  ┌─────────────────────┐  ┌─────────────────────┐       │
│  │   MAIN SCREEN       │  │   ALTERNATE SCREEN  │       │
│  │   (Normal use)      │  │   (Overlays)        │       │
│  │                     │  │                     │       │
│  │  Claude's TUI       │  │  Our usage display  │       │
│  │  lives here         │  │  lives here         │       │
│  │                     │  │                     │       │
│  └─────────────────────┘  └─────────────────────┘       │
│         ▲                         ▲                     │
│         │                         │                     │
│    \x1b[?1049l              \x1b[?1049h                  │
│    (rmcup)                  (smcup)                     │
└─────────────────────────────────────────────────────────┘
```

### How It Works

**Step 1: Switch to Alternate Screen**
```
\x1b[?1049h  (smcup - "start mode cursor positioning")
```

This:
- Saves the main screen content
- Saves the cursor position
- Gives us a blank canvas to draw on

```
BEFORE                          AFTER
┌─────────────────────┐        ┌─────────────────────┐
│ Claude Code v2.1    │        │                     │
│ Opus 4.5            │   →    │  (blank alternate   │
│ ~/Git/claude-hub    │        │   screen)           │
│                     │        │                     │
│ > typing here█      │        │                     │
└─────────────────────┘        └─────────────────────┘
     Main Screen                  Alternate Screen
     (saved!)                     (now visible)
```

**Step 2: Draw Our Content**
```
Hub Usage

main (user@example.com)  <- current
  Session  ████████░░  30%  resets in 2h 55m
  Weekly   ██░░░░░░░░  15%  resets in 6d 16h

account2 (user2@example.com)  (best)
  ...

Press any key to return
█  ← cursor ends up here
```

**Step 3: Switch Back to Main Screen**
```
\x1b[?1049l  (rmcup - "reset mode cursor positioning")
```

This:
- Restores the main screen content
- Restores the cursor position
- Discards the alternate screen

## The Ghost Cursor Problem

When switching back, some terminals leave a "ghost" of where the cursor was on the alternate screen:

```
┌─────────────────────────────┐
│ Claude Code v2.1            │
│ Opus 4.5                    │
│ ~/Git/claude-hub            │
│                             │
│ > typing here█              │  ← Real cursor (correct)
│                             │
│ █                           │  ← Ghost cursor (BUG!)
└─────────────────────────────┘
```

The ghost appears at the position where the cursor was on the alternate screen (after "Press any key to return").

## The Fix: Move Cursor Home Before Switching

By moving the cursor to position (0,0) on the alternate screen BEFORE switching back:

```typescript
// Move cursor to home before switching back
process.stdout.write('\x1b[H');      // Cursor to (0,0)
process.stdout.write('\x1b[?1049l'); // Switch back
```

The cursor position on the alternate screen becomes (0,0), which is in the top-left corner - safely out of the way:

```
Step 3a: Move cursor to home    Step 3b: Switch back
┌─────────────────────────┐    ┌─────────────────────────┐
│█ub Usage                │    │ Claude Code v2.1        │
│                         │    │ Opus 4.5                │
│ main (user@example.com) │ →  │ ~/your-project          │
│   Session  ████████░░   │    │                         │
│   ...                   │    │ > typing here█          │
│                         │    │                         │
│ Press any key to return │    │ (no ghost cursor!)      │
└─────────────────────────┘    └─────────────────────────┘
  Alternate Screen               Main Screen (restored)
  Cursor at (0,0)
```

Even if the terminal has a bug that leaks cursor position, position (0,0) is typically hidden by Claude's header or scrolled off screen.

## Final Implementation

```typescript
// Enter overlay mode
process.stdout.write('\x1b[?1049h'); // Switch to alternate screen
process.stdout.write('\x1b[2J');     // Clear screen
process.stdout.write('\x1b[H');      // Cursor to home

// ... draw content, wait for input ...

// Exit overlay mode (THE FIX)
process.stdout.write('\x1b[H');      // Move cursor to home FIRST
process.stdout.write('\x1b[?1049l'); // Then switch back
```

## Escape Sequence Reference

| Sequence | Name | Description |
|----------|------|-------------|
| `\x1b[?1049h` | smcup | Switch to alternate screen buffer |
| `\x1b[?1049l` | rmcup | Switch to main screen buffer |
| `\x1b[2J` | ED2 | Clear entire screen |
| `\x1b[H` | CUP | Move cursor to home (0,0) |
| `\x1b[?25l` | DECTCEM | Hide cursor |
| `\x1b[?25h` | DECTCEM | Show cursor |

## Why Other Approaches Failed

### 1. Clear Screen + Redraw
```
Clear → Show content → Clear → Trigger Claude redraw
```
**Problem:** Claude doesn't redraw on resize signal alone. Results in black screen.

### 2. Cursor Hide/Show Manipulation
```
Hide cursor → Show content → Show cursor → Switch back
```
**Problem:** Cursor visibility state can leak between screens, creating ghost cursors.

### 3. Slash Command Interception
```
Buffer input → Detect /hub → Run command
```
**Problem:** Characters forwarded to Claude show autocomplete, complex state management.

## Key Takeaways

1. **Alternate screen buffer** is the right approach for overlays
2. **Cursor position can leak** between screen buffers in some terminals
3. **Moving cursor to (0,0)** before switching back prevents visible ghost cursors
4. **Keep it simple** - minimal escape sequences reduce edge cases
