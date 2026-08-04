# Claude Hub

Central hub for syncing and managing multiple Claude Code accounts. Keeps conversations, agents, commands, and skills in sync across accounts, with smart load-balancing to spread usage evenly.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **CLI**: Native Node.js (no framework needed for v1)
- **Config**: JSON config file

## Project Structure

```
claude-hub/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── config.ts          # Configuration management
│   ├── auth/
│   │   ├── status.ts          # Login expiry state per account
│   │   ├── login.ts           # `hub login` command
│   │   └── browser.ts         # Per-account Chrome profile routing
│   ├── sync/
│   │   ├── conversations.ts   # Conversation sync logic
│   │   ├── extensions.ts      # Agents/commands/skills sync
│   │   ├── history.ts         # History.jsonl merge
│   │   └── mcp.ts             # MCP server sync
│   ├── usage/
│   │   ├── api.ts             # Anthropic API usage fetching
│   │   ├── apiDisplay.ts      # Usage display formatting
│   │   ├── parser.ts          # Parse usage from accounts
│   │   └── selector.ts        # Smart account selection
│   ├── pty/
│   │   └── wrapper.ts         # PTY wrapper with F9/F10 detection
│   ├── commands/
│   │   ├── handler.ts         # Command routing & context
│   │   ├── hub.ts             # F9: Usage overlay
│   │   └── switch.ts          # F10: Switch account (Phase 3)
│   ├── display/
│   │   └── startup.ts         # Compact startup box
│   ├── mcp/
│   │   └── commands.ts        # hub mcp add/remove/list subcommands
│   └── utils/
│       └── files.ts           # File utilities
├── docs/
│   └── explanations/
│       └── alternate-screen-buffer.md  # Technical explanation
├── config.json            # User configuration
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Configuration

```json
{
  "accounts": {
    "main": "~/.claude",
    "account2": "~/.claude2"
  },
  "masterFolder": "~/.claude-hub-master",
  "syncOnStart": true
}
```

Accounts can be named anything and you can have as many as needed.

Each account logs in through a Chrome profile **named after the account** (`cc2` uses
Chrome profile `cc2`), created on first use — no configuration needed. The optional
`chromeProfiles` key overrides that, to point an account at a profile you already
have: `"chromeProfiles": { "cc2": "Profile 2" }`.

## Implementation Plans

- `plans/1_claude-hub-implementation.md` - Core functionality (Completed)
- `plans/2_ux-improvements.md` - UX improvements & keyboard shortcuts (Completed)
- `plans/4_mcp-sync.md` - MCP server sync across accounts (Completed)
- `plans/5_login-lifecycle.md` - Login expiry, auto re-login, browser profiles (Completed)

## Phase Status (Plan 5: Login Lifecycle)

- [x] Phase 1: Stop hub refreshing tokens (it was killing idle logins)
- [x] Phase 2: Surface login expiry in startup box, F9, and `hub --usage`
- [x] Phase 3: `hub login` with a Chrome profile per account
- [x] Phase 4: Auto sign-in on launch, renewal prompt, browser cleanup

## Keyboard Shortcuts (while Claude is running)

| Key | Action |
|-----|--------|
| **F9** | Show usage for all accounts |
| **F10** | Switch to another account |

Technical docs: `docs/explanations/alternate-screen-buffer.md`

## Usage

```bash
hub                    # Auto-selects best account, syncs, runs claude
hub --account account2 # Force specific account
hub --sync             # Manual sync only
hub --usage            # Show combined usage across all accounts
hub login              # Show login status (days left) for all accounts
hub login <account>    # Sign an account in, in its own Chrome profile
hub mcp add <name> -- <cmd>  # Add MCP server to all accounts
hub mcp remove <name>        # Remove MCP server from all accounts
hub mcp list                 # List MCP servers
```

## Key Features

1. **Auto-sync**: Syncs all accounts before each session
2. **Master folder**: Single source of truth for agents/commands/skills/MCP servers
3. **Smart selection**: Picks account with most remaining quota
4. **Load balancing**: Spreads usage evenly to avoid maxing one account
5. **Combined usage**: See total remaining across all accounts
6. **MCP sync**: `hub mcp add` installs MCP servers to all accounts at once
7. **Login lifecycle**: Warns before a login expires, offers to renew it at launch,
   signs lapsed accounts in automatically, and routes each account's login to its own
   Chrome profile

## Development

```bash
npm install
npm run build
npm link  # Makes 'hub' command available globally
```

## Notes

- Conversations are synced by copying .jsonl files (includes renames)
- Extensions sync from master → all accounts
- MCP servers sync from master's `.claude.json` → all accounts' `.claude.json` (only the `mcpServers` key; account-specific data is preserved)
- Local extension additions are detected and copied to master
- Config path quirk: `~/.claude` stores config at `~/.claude.json`, other dirs at `<dir>/.claude.json` — use `getClaudeConfigPath()` from `utils/files.ts`
- **Never refresh OAuth tokens from hub.** Anthropic rotates refresh tokens on every
  use, so a refresh performed (or interrupted) outside the Claude CLI leaves the CLI
  holding a superseded token, which the server rejects with `invalid_grant` — and
  Claude Code then blanks the credential, forcing a full re-login. Hub only ever
  *reads* credentials; refreshing belongs to `claude`. See `plans/5_login-lifecycle.md`.
- A login lasts ~30 days from `/login` and refreshing does **not** extend it (measured:
  a refresh re-derives `refreshTokenExpiresAt` from a server countdown to the same fixed
  deadline). Only a fresh login resets the clock, which is why `hub login` doubles as
  "renew" and works on healthy accounts. Blanked tokens (`accessToken: ""`) mean logged
  out, not corrupt.
