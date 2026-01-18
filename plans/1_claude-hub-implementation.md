# Claude Hub Implementation Plan

## Overview

Build a CLI tool that syncs and manages multiple Claude Code accounts, with smart load-balancing to spread usage evenly across accounts.

**Goals:**
1. Keep conversations synced across all accounts
2. Single source of truth for agents/commands/skills
3. Auto-sync before each Claude session
4. Smart account selection based on remaining usage
5. Combined usage display across all accounts

---

## Technical Reference

### Account Directories

Each user can configure multiple Claude Pro accounts with separate config directories:

| Account | Config Directory | How to Run |
|---------|------------------|------------|
| main (primary) | `~/.claude` | `claude` |
| account2 | `~/.claude2` | `CLAUDE_CONFIG_DIR=~/.claude2 claude` |
| account3 | `~/.claude3` | `CLAUDE_CONFIG_DIR=~/.claude3 claude` |

**How to run Claude with a specific account:**
```bash
CLAUDE_CONFIG_DIR=~/.claude2 claude
```

### Master Folder (Source of Truth for Extensions)

Location: `~/.claude-hub-master/` (or any directory you configure)

Structure:
```
~/.claude-hub-master/
├── agents/
│   └── my-agent.md
├── commands/
│   └── my-command.md
├── skills/
│   └── my-skill/
│       └── SKILL.md
└── claude.md
```

### Claude Code Config Directory Structure

Each account's config directory (e.g., `~/.claude3/`) contains:

```
~/.claude3/
├── .claude.json           # Account settings, project metadata
├── .claude.json.backup    # Backup of settings
├── history.jsonl          # Conversation history index
├── projects/              # Conversation files by project
│   └── -Users-claude-Git-projectname/
│       ├── abc123-def456-....jsonl    # Conversation 1
│       └── xyz789-ghi012-....jsonl    # Conversation 2
├── agents/                # Custom agents (markdown files)
├── commands/              # Custom commands (markdown files)
├── skills/                # Custom skills (directories with SKILL.md)
├── debug/                 # Debug logs
├── todos/                 # Todo lists
└── cache/                 # Various caches
```

### Project Directory Naming Convention

Project paths are converted to directory names by replacing `/` with `-`:

| Project Path | Directory Name |
|--------------|----------------|
| `/Users/yourname/projects/myapp` | `-Users-yourname-projects-myapp` |
| `/Users/yourname/work/api` | `-Users-yourname-work-api` |

### Conversation File Format (.jsonl)

Each conversation is a JSONL file named with a UUID (e.g., `d66e6b4d-153d-4adf-bb54-b9a3a921b4f8.jsonl`).

**Key entry types:**

1. **User message:**
```json
{"parentUuid":"...", "type":"user", "sessionId":"d66e6b4d-...", "message":{"role":"user","content":"..."}, "uuid":"...", "timestamp":"2026-01-18T06:15:00.685Z"}
```

2. **Assistant message:**
```json
{"parentUuid":"...", "type":"assistant", "sessionId":"d66e6b4d-...", "message":{"role":"assistant","content":"..."}, "uuid":"...", "timestamp":"..."}
```

3. **Custom title (from /rename command):**
```json
{"type":"custom-title", "customTitle":"claudium-main", "sessionId":"d66e6b4d-..."}
```

4. **File history snapshot:**
```json
{"type":"file-history-snapshot", "messageId":"...", "snapshot":{...}}
```

### History.jsonl Format

Each line is a JSON object representing a conversation entry point:

```json
{"display":"what I want to do...", "pastedContents":{}, "timestamp":1768716900646, "project":"/Users/yourname/projects/myapp", "sessionId":"d66e6b4d-153d-4adf-bb54-b9a3a921b4f8"}
```

**Fields:**
- `display`: First message or command (used as conversation preview)
- `timestamp`: Unix timestamp in milliseconds
- `project`: Absolute path to the project
- `sessionId`: UUID linking to the conversation file
- `pastedContents`: Any pasted content (usually empty `{}`)

**Deduplication key:** `sessionId` + `timestamp`

### Usage Command Output

Running `claude /usage` outputs usage information. The exact format needs to be captured during Phase 5 implementation, but typically includes:
- Current session usage (percentage or tokens)
- Weekly usage (percentage or tokens)
- Reset times

**Note:** Run `CLAUDE_CONFIG_DIR=~/.claude claude` and type `/usage` to capture actual output format during implementation.

---

## Phase 1: Project Setup + Configuration System

### Context
Empty repository. Need to set up TypeScript project and configuration management.

### Prerequisites
- Node.js installed
- Git repo created (done)

### Tasks

1. **Initialize Node.js project**
   - Create `package.json` with TypeScript dependencies
   - Create `tsconfig.json` for TypeScript configuration
   - Set up build scripts

2. **Create configuration system**
   - `src/config.ts`: Load/save configuration
   - `config.example.json`: Example configuration file
   - Support `~` expansion for paths
   - Configurable: accounts, masterFolder, syncOnStart

3. **Create file utilities**
   - `src/utils/files.ts`: Path expansion, file copying, directory walking

4. **Create CLI entry point**
   - `src/index.ts`: Basic CLI that loads config and prints status

### Files to Create
```
package.json
tsconfig.json
config.example.json
src/index.ts
src/config.ts
src/utils/files.ts
```

### Success Criteria
- `npm run build` compiles without errors
- Running `node dist/index.js` loads config and prints account paths
- Config supports ~ expansion correctly

### Manual Testing
```bash
cd ~/your-clone-location/claude-hub
npm install
npm run build
node dist/index.js
# Should print: "Claude Hub initialized with N accounts" (where N = accounts in config)
```

---

## Phase 2: Conversation Sync Engine

### Context
Project is set up with config system. Now implement conversation syncing.

### Prerequisites
- Phase 1 complete
- Config loads correctly

### Tasks

1. **Implement conversation discovery**
   - `src/sync/conversations.ts`
   - Find all project directories in each account
   - List all .jsonl conversation files

2. **Implement conversation sync logic**
   - For each conversation file:
     - Check if exists in other accounts
     - If not, copy it
     - If exists, compare timestamps, keep newer
   - Handle new conversations added to any account

3. **Implement project directory sync**
   - Create project directories in target accounts if missing
   - Preserve directory structure: `projects/-Users-claude-Git-projectname/`

### Files to Create/Modify
```
src/sync/conversations.ts    # New
src/sync/index.ts            # New - export all sync functions
src/index.ts                 # Add sync command
```

### Sync Logic
```
For each account (source):
  For each project directory:
    For each .jsonl file:
      For each other account (target):
        If file doesn't exist in target:
          Copy file to target
        Else if source is newer:
          Copy file to target (overwrite)
```

### Success Criteria
- Conversations from one account appear in others after sync
- Newer conversations overwrite older ones
- No data loss (older files not deleted)

### Manual Testing
```bash
# 1. Create a test conversation in account2
cd ~/some-project
CLAUDE_CONFIG_DIR=~/.claude2 claude
# Have a conversation, then exit

# 2. Run sync
node dist/index.js --sync

# 3. Verify conversation exists in both accounts
ls ~/.claude/projects/-Users-yourname-some-project/
ls ~/.claude2/projects/-Users-yourname-some-project/
# Should see the same .jsonl file

# 4. Resume conversation from different account
cd ~/some-project && claude
# /resume should show the conversation
```

---

## Phase 3: History + Extensions Sync

### Context
Conversation sync works. Now sync history.jsonl and extensions (agents/commands/skills).

### Prerequisites
- Phase 2 complete
- Conversations sync correctly

### Tasks

1. **Implement history.jsonl merge**
   - `src/sync/history.ts`
   - Merge history entries from all accounts
   - Deduplicate by sessionId + timestamp
   - Sort by timestamp

2. **Implement extensions sync FROM master**
   - `src/sync/extensions.ts`
   - Sync agents/ from master to all accounts
   - Sync commands/ from master to all accounts
   - Sync skills/ from master to all accounts
   - Delete files in accounts that don't exist in master

3. **Implement local extension detection**
   - Detect new extensions added directly to an account
   - Copy them to master folder
   - Then sync to other accounts

### Files to Create/Modify
```
src/sync/history.ts       # New
src/sync/extensions.ts    # New
src/sync/index.ts         # Update exports
```

### Extensions Sync Logic

**IMPORTANT: Order of operations matters!**

```
# Step 1: Detect local additions FIRST (before deletion check)
For each account:
  For each file in account/{agents,commands,skills}:
    If not in master:
      Copy to master
      Log: "Detected new extension: {filename}, added to master"

# Step 2: Master → Accounts (authoritative, now includes newly detected)
For each file in master/{agents,commands,skills}:
  For each account:
    Copy file to account (overwrite if newer)

# Step 3: Handle deletions (master is source of truth)
# Only delete files that:
#   1. Exist in account but NOT in master
#   2. Were NOT just added in Step 1 (use a "just_added" set to track)
# This prevents deleting a file that was just detected as new
For each account:
  For each file in account/{agents,commands,skills}:
    If not in master AND not in just_added set:
      Delete from account
      Log: "Removed extension: {filename} (deleted from master)"
```

**Edge case:** If user adds a file to account2 and deletes the same-named file from master before sync runs, the file should be preserved (detected as new and re-added to master). Newest file wins.

### Success Criteria
- Extensions from master appear in all accounts
- New extensions added to any account get copied to master
- Deleted extensions (from master) get removed from all accounts
- History entries merged without duplicates

### Manual Testing
```bash
# 1. Add a new command to account2 directly
echo "# Test command" > ~/.claude2/commands/test-cmd.md

# 2. Run sync
node dist/index.js --sync

# 3. Verify it was copied to master and other accounts
cat ~/.claude-hub-master/commands/test-cmd.md  # Should exist
cat ~/.claude/commands/test-cmd.md             # Should exist

# 4. Delete from master
rm ~/.claude-hub-master/commands/test-cmd.md

# 5. Run sync again
node dist/index.js --sync

# 6. Verify deleted from all accounts
ls ~/.claude/commands/test-cmd.md   # Should not exist
ls ~/.claude2/commands/test-cmd.md  # Should not exist
```

---

## Phase 4: CLI Wrapper with Auto-Sync

### Context
Sync engine complete. Now create CLI wrapper that auto-syncs and runs Claude.

### Prerequisites
- Phase 3 complete
- All sync functions working

### Tasks

1. **Create CLI wrapper**
   - `src/index.ts`: Full CLI implementation
   - Parse command line arguments
   - Support: `hub`, `hub --sync`, `hub --account <name>`

2. **Implement auto-sync on start**
   - Run full sync before launching Claude
   - Show brief sync summary

3. **Implement Claude passthrough**
   - Spawn `claude` with correct `CLAUDE_CONFIG_DIR`
   - Pass all arguments through
   - Inherit stdio for interactive use

4. **Create npm bin entry**
   - Add `bin` field to package.json
   - Make `hub` command available after `npm link`

### Files to Modify
```
src/index.ts       # Full CLI implementation
package.json       # Add bin entry
```

### CLI Interface
```bash
hub                     # Sync + run claude with default account
hub --account account2  # Sync + run claude with specific account
hub --sync              # Only sync, don't run claude
hub --help              # Show help
hub [claude args]       # Pass remaining args to claude
```

### Success Criteria
- `hub` command works globally after `npm link`
- Auto-syncs before running Claude
- Passes all arguments to Claude correctly
- Interactive Claude session works normally

### Manual Testing
```bash
# 1. Build and link
npm run build && npm link

# 2. Test basic usage
hub --help
# Should show help text

# 3. Test sync only
hub --sync
# Should sync and show summary

# 4. Test Claude passthrough
hub
# Should sync, then start Claude
# Interactive session should work normally

# 5. Test account selection
hub --account account2
# Should use account2

# 6. Test argument passthrough
hub --resume abc123
# Should pass --resume to Claude
```

---

## Phase 5: Combined Usage Display

### Context
CLI wrapper works. Now add combined usage display across all accounts.

### Prerequisites
- Phase 4 complete
- CLI wrapper working

### Tasks

1. **Implement usage parser**
   - `src/usage/parser.ts`
   - Run `claude /usage` on each account
   - Parse output to extract:
     - Current session usage (% remaining)
     - Weekly usage (% remaining)
     - Reset times

2. **Implement combined usage display**
   - `src/usage/display.ts`
   - Show usage for all accounts in a table
   - Show totals/averages
   - Highlight account with most remaining

3. **Add --usage flag to CLI**
   - `hub --usage`: Show combined usage, don't run Claude

### Files to Create/Modify
```
src/usage/parser.ts     # New
src/usage/display.ts    # New
src/usage/index.ts      # New - exports
src/index.ts            # Add --usage flag
```

### Usage Output Format
```
╔════════════════════════════════════════════════════════╗
║                  Claude Hub Usage                       ║
╠════════════╦═══════════════════╦═══════════════════════╣
║  Account   ║  Session (5h)     ║  Weekly               ║
╠════════════╬═══════════════════╬═══════════════════════╣
║  main      ║  45% remaining    ║  78% remaining        ║
║  account2  ║  100% remaining   ║  92% remaining        ║  ← Best
╠════════════╬═══════════════════╬═══════════════════════╣
║  TOTAL     ║  ~72% average     ║  ~85% average         ║
╚════════════╩═══════════════════╩═══════════════════════╝

Recommended: account2 (highest remaining)
```

### Success Criteria
- `hub --usage` shows usage for all configured accounts
- Output is readable and clear
- Highlights best account to use

### Manual Testing
```bash
hub --usage
# Should show table with all accounts
# Should recommend account with most remaining
```

---

## Phase 6: Smart Account Selection with Load Balancing

### Context
Usage parsing works. Now implement smart account selection that balances load.

### Prerequisites
- Phase 5 complete
- Usage parsing working

### Tasks

1. **Implement account selector**
   - `src/usage/selector.ts`
   - Score each account based on:
     - Session usage remaining (weight: 60%)
     - Weekly usage remaining (weight: 40%)
   - Pick account with highest score
   - Avoid accounts at 0% session (unless all are)

2. **Implement load balancing logic**
   - Don't always pick the same account
   - Spread usage evenly across accounts
   - Example: If main has 50% and account2 has 100%, pick account2

3. **Integrate with CLI**
   - Default behavior: auto-select best account
   - Show which account was selected
   - Allow override with --account flag

4. **Handle rate limit detection**
   - **API Detection (pre-flight)**: Check `fiveHourRemaining <= 0` before launching
   - **CLI Detection (runtime)**: Watch for rate limit message in Claude output

   **Claude CLI Rate Limit Message Format** (observed 2026-01-29):
   ```
   You've hit your limit • resets 12am (America/New_York)
   ```
   - Appears in red text
   - Followed by `/rate-limit-options` interactive prompt
   - Options: "1. Stop and wait for limit to reset" / "2. Upgrade your plan"

   **Detection Strategy**:
   - Pre-flight: Use API to check `fiveHourUsed >= 100` → skip this account
   - Runtime: Parse stdout for "You've hit your limit" string
   - (Future: auto-switch, but manual suggestion for v1)

### Files to Create/Modify
```
src/usage/selector.ts   # New
src/index.ts            # Integrate smart selection
```

### Selection Algorithm
```typescript
function selectBestAccount(usages: AccountUsage[]): string {
  // Filter out accounts with 0% session remaining (rate limited)
  const available = usages.filter(u => u.sessionRemaining > 0);

  if (available.length === 0) {
    // All rate limited, pick one with soonest reset
    return usages.sort((a, b) => a.sessionResetTime - b.sessionResetTime)[0].name;
  }

  // Score = 60% session + 40% weekly
  // Higher remaining % = higher score = more likely to be picked
  const scored = available.map(u => ({
    name: u.name,
    score: (u.sessionRemaining * 0.6) + (u.weeklyRemaining * 0.4)
  }));

  // Pick highest score (most remaining = should be used to balance)
  return scored.sort((a, b) => b.score - a.score)[0].name;
}
```

### Success Criteria
- Without --account flag, CLI picks best account automatically
- Load is balanced across accounts over time
- Account with most remaining is preferred
- Rate-limited accounts are avoided

### Manual Testing
```bash
# 1. Check usage first
hub --usage
# Note which account has most remaining

# 2. Run without specifying account
hub
# Should auto-select the account with most remaining
# Should show: "Selected account: account2 (92% remaining)"

# 3. Use Claude until rate limited on one account

# 4. Run again
hub
# Should select a different account now

# 5. Force specific account
hub --account main
# Should use main regardless of usage
```

---

## Post-Implementation

### After All Phases Complete

1. **Update shell aliases** (optional convenience)
   ```bash
   # In your shell config, optionally add:
   alias claude='hub'
   # Or create shortcuts for specific accounts if needed
   ```

2. **Create README.md** with:
   - Installation instructions
   - Usage examples
   - Configuration guide

3. **Consider future enhancements**
   - Auto-switch on rate limit (v2)
   - Sync project-level settings
   - Web UI for usage monitoring
   - Notifications when usage is low

### Maintenance

- Master folder (configured in `config.json`) is the source of truth for extensions
- To add a new command/agent/skill: add it to master, run `hub --sync`
- To remove: delete from master, run `hub --sync`
- Conversations auto-sync on every `hub` invocation

---

## Important Edge Cases & Considerations

### Conversation Sync Edge Cases

1. **Same sessionId in multiple accounts**: Should not happen (UUIDs are unique), but if it does, merge by taking the file with more entries or newer timestamp.

2. **Conversation modified in two accounts simultaneously**: Take the newer file (by mtime). Data loss is possible but unlikely since user typically only uses one account at a time.

3. **Large conversation files**: Some files can be 100KB+. Use streaming/buffered copy, not read-all-into-memory.

4. **New project created**: If a project directory exists in one account but not others, create the directory in all accounts.

### Extensions Sync Edge Cases

1. **Skills are directories, not files**: Skills contain a folder with `SKILL.md` and potentially other files. Sync the entire directory recursively.

2. **Hidden files (.DS_Store, etc.)**: Skip `.DS_Store` and other hidden files during sync.

3. **Permissions**: Ensure copied files maintain appropriate permissions (readable by user).

### History Merge Edge Cases

1. **Duplicate entries**: Same sessionId + timestamp = duplicate. Keep only one.

2. **Very large history**: If history.jsonl grows huge, consider truncating very old entries (optional, not for v1).

### Config Considerations

1. **config.json should be in .gitignore**: Contains local paths, not suitable for git.

2. **config.example.json should be committed**: Template for users to copy.

3. **First-run experience**: If config.json doesn't exist, copy from config.example.json or prompt user.

### File Watching (NOT for v1)

For v1, sync is triggered manually or on `hub` invocation. File watching (auto-sync on file change) is a future enhancement that would use something like `chokidar` but adds complexity.

---

## Files to Create (Summary)

```
claude-hub/
├── .gitignore              # Ignore config.json, node_modules, dist
├── package.json            # Dependencies: typescript
├── tsconfig.json           # TypeScript config
├── config.example.json     # Example config (committed)
├── config.json             # User config (gitignored)
├── CLAUDE.md               # Project docs
├── plans/
│   └── 1_claude-hub-implementation.md
└── src/
    ├── index.ts            # CLI entry point
    ├── config.ts           # Config loading
    ├── sync/
    │   ├── index.ts        # Export all sync functions
    │   ├── conversations.ts
    │   ├── history.ts
    │   └── extensions.ts
    ├── usage/
    │   ├── index.ts
    │   ├── parser.ts
    │   ├── display.ts
    │   └── selector.ts
    └── utils/
        └── files.ts        # Path utils, file copy
```
