# Plan 4: MCP Server Sync

Sync MCP (Model Context Protocol) servers across all Claude accounts managed by Hub. Adds `hub mcp` subcommands that proxy to `claude mcp` targeting the master folder, plus automatic sync of the `mcpServers` key from master's `.claude.json` to all accounts during the normal sync flow.

## Context

- MCP servers are stored in `.claude.json` under the top-level `mcpServers` key (when using `--scope user`)
- **Critical path quirk**: For the default `~/.claude` dir, the config file is `~/.claude.json` (at HOME level). For all other dirs (e.g., `~/.claude-cc1`), it's `<dir>/.claude.json` (inside the dir). See `src/usage/api.ts:getAccountInfo()` lines 191-198.
- Each account's `.claude.json` has account-specific data (`oauthAccount`, `userID`, `projects`, etc.) that must NOT be overwritten
- The master folder (from `config.masterFolder`) already serves as source of truth for extensions
- `CLAUDE_CONFIG_DIR=<dir> claude mcp add --scope user <args>` writes MCP config into `<dir>/.claude.json`

## Tech Stack

- Node.js + TypeScript (same as existing codebase)
- `child_process.spawnSync` for proxying `claude mcp` commands

---

## Phase 1: MCP Sync Engine

Add a new sync module that reads `mcpServers` from the master folder's `.claude.json` and merges just that key into each account's `.claude.json`.

### Files to create:
- `src/sync/mcp.ts` — MCP sync logic

### Files to modify:
- `src/utils/files.ts` — Add `getClaudeConfigPath(configDir)` helper
- `src/sync/index.ts` — Re-export new module
- `src/display/startup.ts` — Add `mcp` to `SyncSummary` interface
- `src/index.ts` — Call `syncMcp()` in `runSync()`, include in `SyncSummary`

### Implementation details:

**`src/utils/files.ts` — New helper:**

Add a `getClaudeConfigPath(configDir: string): string` function that resolves the correct `.claude.json` path for any account directory. This handles the Claude Code quirk where:
- Default `~/.claude` → config is at `~/.claude.json` (HOME level, outside the dir)
- All other dirs → config is at `<dir>/.claude.json` (inside the dir)

This logic already exists inline in `src/usage/api.ts:getAccountInfo()` (lines 191-198). Extract it as a reusable helper since MCP sync needs it too.

```typescript
export function getClaudeConfigPath(configDir: string): string {
  const expandedPath = expandPath(configDir);
  const homeDir = os.homedir();
  const defaultDir = path.join(homeDir, '.claude');

  if (expandedPath === defaultDir) {
    return path.join(homeDir, '.claude.json');
  }
  return path.join(expandedPath, '.claude.json');
}
```

Also refactor `src/usage/api.ts:getAccountInfo()` to use this new helper instead of its inline logic.

**`src/sync/mcp.ts`:**
```typescript
export interface McpSyncStats {
  serversSynced: number;   // number of MCP servers in master
  accountsUpdated: number; // number of accounts that were changed
}
```

Core function: `syncMcp(config: Config, verbose: boolean): McpSyncStats`

Logic:
1. Resolve master config path using `getClaudeConfigPath(config.masterFolder)` — if file doesn't exist or has no `mcpServers` key, return `{ serversSynced: 0, accountsUpdated: 0 }` (no-op)
2. Parse the `mcpServers` object from master
3. For each account in `config.accounts`:
   a. Resolve config path using `getClaudeConfigPath(accountPath)`
   b. Read the file — if it doesn't exist, skip with warning (account likely not initialized)
   c. Parse the JSON
   d. Compare existing top-level `mcpServers` with master's `mcpServers` (JSON.stringify deep-equal)
   e. If different: set `data.mcpServers = masterMcpServers`, write back the file (preserving all other keys)
   f. Track stats
4. Return stats

Important:
- **Use `getClaudeConfigPath()` for ALL config path resolution** — never assume `<dir>/.claude.json`
- Only touch the **top-level** `mcpServers` key — never touch `projects[*].mcpServers`
- Read the full JSON, modify only `mcpServers`, write back — preserves all account-specific data
- Use `JSON.stringify(data, null, 2)` to match Claude's own formatting
- Handle edge case: account `.claude.json` exists but has no `mcpServers` key yet — just add it
- Handle edge case: master `mcpServers` is `{}` (empty) — still sync it (this clears servers from accounts if all were removed from master)

Also export: `listMcpServers(config: Config): void` — Debug listing showing master's MCP servers and each account's status

**`src/sync/index.ts`:**
- Add `export { syncMcp, McpSyncStats, listMcpServers } from './mcp';`

**`src/display/startup.ts`:**
- Add `mcp: { serversSynced: number; accountsUpdated: number }` to `SyncSummary`
- Update `buildSyncLine()` to include MCP changes in the `totalChanges` count

**`src/index.ts`:**
- Import `syncMcp` from sync module
- Add `syncMcp()` call in `runSync()` after `syncExtensions()`
- Include `mcp` stats in the returned `SyncSummary`
- Update `displayVerboseSyncDetails()` to show MCP sync stats

### Testing:
- Run `hub --sync -v` — should show MCP sync stats (0 synced if no master `.claude.json`)
- Manually create `<masterFolder>/.claude.json` with `{"mcpServers": {"test": {"type": "stdio", "command": "echo", "args": ["hello"]}}}`
- Run `hub --sync -v` — should show servers synced to accounts
- Verify accounts' `.claude.json` have the `mcpServers` key without any other data being changed
- Verify `oauthAccount`, `userID`, `projects` etc. are untouched

---

## Phase 2: `hub mcp` Subcommands

Add `hub mcp add`, `hub mcp remove`, and `hub mcp list` commands that proxy to `claude mcp` with `CLAUDE_CONFIG_DIR` pointing to the master folder.

### Files to create:
- `src/mcp/commands.ts` — MCP subcommand logic

### Files to modify:
- `src/index.ts` — Detect `mcp` subcommand in arg parsing, route to MCP handler, update help text

### Implementation details:

**Arg parsing in `src/index.ts`:**

Detect `hub mcp ...` as a subcommand. When `process.argv[2] === 'mcp'`:
- Extract everything after `mcp` as MCP args (e.g., `hub mcp add codex-cli -- npx -y codex-mcp-server` → mcpArgs = `['add', 'codex-cli', '--', 'npx', '-y', 'codex-mcp-server']`)
- Add `mcp: string[] | null` to `CliArgs` interface
- Route to MCP handler in `main()` before other flag processing

**`src/mcp/commands.ts`:**

```typescript
export function handleMcpCommand(mcpArgs: string[], config: Config, verbose: boolean): void
```

Logic:
1. Determine the sub-subcommand: `mcpArgs[0]` should be `add`, `remove`, or `list`
2. For `add` and `remove`:
   - Force `--scope user` — inject it if not present, replace if set to something else
   - Spawn: `spawnSync('claude', ['mcp', ...mcpArgs], { stdio: 'inherit', env: { ...process.env, CLAUDE_CONFIG_DIR: config.masterFolder } })`
   - If exit code 0 AND sub-subcommand was `add` or `remove`: auto-run `syncMcp(config, verbose)` to immediately propagate the change
   - Print summary: "MCP server synced to N accounts"
3. For `list`:
   - Spawn same way (targeting master) so user sees what's configured in the source of truth
   - Also show a note: "Showing MCP servers from master config (synced to all accounts)"
4. For unknown subcommand or no args: print MCP help

**Help text (`showHelp()` in index.ts):**

Add to the usage section:
```
  hub mcp add <name> [args]    Add MCP server (synced to all accounts)
  hub mcp remove <name>        Remove MCP server from all accounts
  hub mcp list                 List MCP servers
```

**Error handling:**
- Before spawning `claude mcp add/remove`: call `ensureDir(config.masterFolder)` so the master folder exists (otherwise `claude` may fail silently)
- If `claude` command not found: print helpful error
- If `claude mcp add` fails: show the error, don't run sync

### Testing:
- `hub mcp list` — should show empty list (or current servers if any)
- `hub mcp add test-server -- echo hello` — should add to master and sync to all accounts
- Verify `<masterFolder>/.claude.json` has the server
- Verify all accounts' `.claude.json` have the server under top-level `mcpServers`
- `hub mcp list` — should show the test server
- `hub mcp remove test-server` — should remove from master and sync to all accounts
- Verify accounts no longer have the server
- `hub mcp add --scope local test` — should still use `--scope user` (overridden)
- `hub mcp` (no subcommand) — should show MCP help
- Run `hub` normally after adding MCP servers — startup should show MCP sync in the sync line

---

## Phase 3: Polish & Edge Cases

Final polish: handle edge cases, update CLAUDE.md documentation, ensure everything is robust.

### Files to modify:
- `src/sync/mcp.ts` — Edge case hardening
- `src/mcp/commands.ts` — Edge case hardening
- `CLAUDE.md` — Update docs with MCP sync info

### Implementation details:

**Edge case hardening in `src/sync/mcp.ts`:**
- If master's `.claude.json` is malformed JSON: catch error, warn, skip MCP sync (don't crash)
- If account's `.claude.json` is malformed JSON: catch error, warn, skip that account (don't crash)
- If account's `.claude.json` is not writable: catch error, warn, continue with other accounts
- Add a quick deep-equal check to avoid unnecessary writes (only write if `mcpServers` actually changed)

**Edge case hardening in `src/mcp/commands.ts`:**
- Pass through ALL `claude mcp add` flags correctly: `-e/--env`, `-t/--transport`, `-H/--header`, `--callback-port`, `--client-id`, `--client-secret`
- Handle the `--` separator correctly (it separates claude mcp flags from the server command)
- If `hub mcp add` is called with `--scope project` or `--scope local`: warn that hub always uses `--scope user` and proceed

**CLAUDE.md updates:**
- Add MCP sync to the Key Features section
- Add `hub mcp` commands to the Usage section
- Update the Project Structure with new files
- Note that MCP servers are synced via master folder's `.claude.json`

### Testing:
- Full flow: `hub mcp add codex-cli -- npx -y codex-mcp-server` → `hub` (verify sync) → `hub mcp list` → `hub mcp remove codex-cli`
- Verify no data loss in account `.claude.json` files after multiple sync cycles
- Test with malformed master `.claude.json` — should warn and not crash
- `hub --sync -v` should show MCP sync line
- Startup box should count MCP changes in the sync total
