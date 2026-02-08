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

## Implementation Plans

- `plans/1_claude-hub-implementation.md` - Core functionality (Completed)
- `plans/2_ux-improvements.md` - UX improvements & keyboard shortcuts (Completed)
- `plans/4_mcp-sync.md` - MCP server sync across accounts (Completed)

## Phase Status (Plan 4: MCP Server Sync)

- [x] Phase 1: MCP sync engine
- [x] Phase 2: `hub mcp` subcommands
- [x] Phase 3: Polish & edge cases

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
