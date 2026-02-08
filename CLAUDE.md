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
│   │   └── history.ts         # History.jsonl merge
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
- `plans/4_mcp-sync.md` - MCP server sync across accounts (Active)

## Phase Status (Plan 4: MCP Server Sync)

- [ ] Phase 1: MCP sync engine
- [ ] Phase 2: `hub mcp` subcommands
- [ ] Phase 3: Polish & edge cases

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
```

## Key Features

1. **Auto-sync**: Syncs all accounts before each session
2. **Master folder**: Single source of truth for agents/commands/skills
3. **Smart selection**: Picks account with most remaining quota
4. **Load balancing**: Spreads usage evenly to avoid maxing one account
5. **Combined usage**: See total remaining across all accounts

## Development

```bash
npm install
npm run build
npm link  # Makes 'hub' command available globally
```

## Notes

- Conversations are synced by copying .jsonl files (includes renames)
- Extensions sync from master → all accounts
- Local extension additions are detected and copied to master
- Usage data parsed from `claude /usage` output
