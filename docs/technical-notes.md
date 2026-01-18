# Technical Notes

Important technical discoveries and implementation details for Claude Hub.

## node-pty Compatibility

**Issue:** node-pty v1.1.0 has a bug on macOS ARM64 that causes `posix_spawnp failed` error.

**Solution:** Use node-pty v1.0.0 (locked in package.json).

**Details:**
- The error occurs when spawning any process through PTY
- Affects macOS ARM64 (Apple Silicon) with Node.js 22+
- Version 1.0.0 works correctly

## node-pty PATH Resolution

**Issue:** node-pty doesn't do PATH resolution like a shell does. Running `pty.spawn('claude', ...)` fails even if `claude` is in PATH.

**Solution:** Use `which` to resolve the full path before spawning:

```typescript
import { execSync } from 'child_process';

function resolveCommand(command: string): string {
  try {
    return execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
  } catch {
    return command;
  }
}

// Usage
const fullPath = resolveCommand('claude'); // → ~/.local/bin/claude (or wherever claude is installed)
pty.spawn(fullPath, args, options);
```

## Rate Limit Detection

### Claude CLI Message Format

When a user hits the rate limit, Claude Code displays:

```
You've hit your limit • resets 12am (America/New_York)
```

Followed by an interactive `/rate-limit-options` prompt with options:
1. Stop and wait for limit to reset
2. Upgrade your plan

### Local Storage

**Rate limit state is NOT stored locally.** The only trace in the filesystem is:
- `history.jsonl` logs `/rate-limit-options` command with timestamp when user interacts with the menu

The actual usage percentages come from the **API only**.

### API Detection

Check `fiveHourUsed >= 100` or `fiveHourRemaining <= 0` from the usage API response.

## Usage API

**Endpoint:** `https://api.anthropic.com/api/oauth/usage`

**Authentication:** Bearer token from macOS Keychain

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
anthropic-beta: oauth-2025-04-20
```

**Response Structure:**
```json
{
  "five_hour": {
    "utilization": 45.5,
    "resets_at": "2026-01-30T10:00:00Z"
  },
  "seven_day": {
    "utilization": 28.0,
    "resets_at": "2026-02-05T19:00:00Z"
  }
}
```

- `utilization` is a percentage (0-100) of **used** capacity
- `resets_at` is an ISO 8601 timestamp

## Keychain Service Names

Claude Code stores OAuth tokens in macOS Keychain with directory-specific names:

| Config Directory | Keychain Service Name |
|------------------|----------------------|
| `~/.claude` (default) | `Claude Code-credentials` |
| `~/.claude2` | `Claude Code-credentials-{hash}` |
| `~/.claude3` | `Claude Code-credentials-{hash}` |

Where `{hash}` is the first 8 characters of SHA256(expanded_config_path).

See [multi-account-keychain.md](multi-account-keychain.md) for details.

## PTY Input Interception

To intercept commands like `/switch` before they reach Claude:

1. Buffer stdin in the PTY wrapper
2. Look for lines starting with `/switch`, `/hub`, etc.
3. When detected, suppress from Claude and handle ourselves
4. For commands that need to restart Claude (like `/switch`):
   - Kill current PTY process
   - Perform the action (sync, show menu, etc.)
   - Restart PTY with new config + `--resume <sessionId>`

## Session Continuity

When switching accounts mid-session:

1. Find the active session ID from the most recently modified `.jsonl` file in `projects/`
2. Sync conversations to all accounts
3. Launch new account with `--resume <sessionId>`

The conversation continues seamlessly because:
- Conversations are stored as `.jsonl` files
- Hub syncs these across all accounts
- `--resume` loads the conversation on any account that has the file

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLAUDE_CONFIG_DIR` | Override Claude's config directory (e.g., `~/.claude2`) |
| `HOME` | Used to compute default Claude directory (`~/.claude`) |

Note: For the default `~/.claude` directory, don't set `CLAUDE_CONFIG_DIR` - let Claude use its natural default. This preserves authentication.
