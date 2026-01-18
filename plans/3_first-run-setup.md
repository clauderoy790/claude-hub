# Plan 3: First-Run Setup & Add Account

## Overview

Make Claude Hub easier to set up for new users with:
1. Interactive first-run setup wizard
2. `hub --add-account <name>` command for adding new accounts

## Goals

- Zero-config first run experience
- Automatic backup via master folder copy
- Easy multi-account setup without manual config editing
- Clear documentation of the multi-account flow

---

## Phase 1: First-Run Setup Wizard

### Context
Currently, users must manually create `config.json` and understand the master folder concept. New users should be guided through setup automatically.

### Tasks

1. **Detect first-run state** (`src/setup/wizard.ts`)
   - Check if `config.json` exists
   - If not, trigger setup wizard

2. **Implement setup wizard flow**
   ```
   $ hub

   ┌─ Claude Hub Setup ─────────────────────────────────────┐
   │ No configuration found. Let's set things up!           │
   └────────────────────────────────────────────────────────┘

   Master folder is where your agents, commands, and skills
   are synced from. It's the "source of truth".

   Master folder path [~/.claude-hub-master]:
   ```

3. **Handle master folder creation**
   - If master folder doesn't exist AND ~/.claude exists:
     - Copy ~/.claude to master folder
     - Print: "✓ Created master folder (copied from ~/.claude)"
   - If master folder already exists:
     - Print: "✓ Using existing master folder"
   - If neither exists:
     - Create empty master folder with agents/, commands/, skills/ subdirs

4. **Detect existing Claude accounts**
   - Scan home directory for `.claude*` directories
   - Filter to valid Claude config dirs (have projects/ or .claude.json)
   - Present list to user:
     ```
     Found existing Claude configs:
       [1] ~/.claude    → add as "main"? (Y/n)
       [2] ~/.claude2   → add as "account2"? (Y/n)
     ```

5. **Generate config.json**
   - Write config with selected accounts
   - Print summary of what was created

6. **Integrate with main CLI**
   - In `src/index.ts`, call setup wizard before `loadConfig()` if no config exists

### Files to Create/Modify
```
src/setup/wizard.ts     # New - setup wizard logic
src/setup/index.ts      # New - exports
src/index.ts            # Modify - call wizard on first run
```

### Success Criteria
- Running `hub` with no config.json triggers setup
- Master folder created with ~/.claude contents
- Existing accounts detected and offered
- config.json generated correctly
- Subsequent `hub` runs work normally

### Manual Testing
```bash
# Remove existing config
rm config.json

# Run hub - should trigger setup
hub

# Verify config.json was created
cat config.json

# Run hub again - should work normally
hub
```

---

## Phase 2: Add Account Command

### Context
Users need an easy way to add new accounts without manually editing config.json or understanding CLAUDE_CONFIG_DIR.

### Tasks

1. **Add --add-account flag parsing** (`src/index.ts`)
   - Parse `hub --add-account <name>`
   - Validate account name (alphanumeric, dash, underscore only)

2. **Implement add account flow** (`src/setup/addAccount.ts`)
   ```
   $ hub --add-account work

   Creating account "work"...

   This will launch Claude to authenticate with your Anthropic account.
   Log in with the account you want to use for "work".

   Press Enter to continue (Ctrl+C to cancel)...

   [Launches: CLAUDE_CONFIG_DIR=~/.claude-work claude]
   [User authenticates in browser]
   [Claude exits]

   ✓ Account "work" added!
     Config directory: ~/.claude-work

   Updated config.json
   ```

3. **Validation**
   - Account name: `/^[a-zA-Z0-9_-]+$/`
   - Check if account already exists in config
   - Check if directory already exists

4. **Directory creation**
   - Create `~/.claude-<name>` directory
   - Launch Claude with CLAUDE_CONFIG_DIR set
   - Wait for Claude to exit
   - Verify authentication succeeded (check for .claude.json or credentials)

5. **Update config.json**
   - Add new account to accounts map
   - Save config

### Files to Create/Modify
```
src/setup/addAccount.ts  # New - add account logic
src/setup/index.ts       # Modify - add export
src/index.ts             # Modify - handle --add-account flag
```

### Success Criteria
- `hub --add-account work` creates ~/.claude-work
- Claude launches for authentication
- After auth, account is added to config.json
- Invalid names are rejected with helpful message
- Duplicate accounts are rejected

### Manual Testing
```bash
# Add a new account
hub --add-account test

# Verify it was added
cat config.json

# Try invalid name
hub --add-account "bad name"
# Should error: "Account name can only contain..."

# Try duplicate
hub --add-account test
# Should error: "Account 'test' already exists"
```

---

## Phase 3: Documentation Updates

### Tasks

1. **Update README.md**
   - Add "Getting Started" section explaining first-run
   - Document `hub --add-account`
   - Explain multi-account setup flow
   - Mention that master folder creation backs up ~/.claude

2. **Update help text**
   - Add --add-account to help output

### Success Criteria
- README clearly explains setup for new users
- Help text shows all options

---

## Summary

| Phase | Description | Key Deliverable |
|-------|-------------|-----------------|
| 1 | First-run setup wizard | Interactive config.json generation |
| 2 | Add account command | `hub --add-account <name>` |
| 3 | Documentation | Updated README with setup guide |
