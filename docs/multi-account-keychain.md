# Multi-Account Keychain Guide

This document explains how Claude Code stores OAuth tokens for multiple accounts in macOS Keychain, and how claude-hub reads them.

## Overview

Claude Code stores OAuth tokens in macOS Keychain with **directory-specific** service names. This allows multiple Claude Pro accounts to coexist, each with its own credentials.

## Keychain Entry Structure

### Service Name Pattern

| Config Directory | Keychain Service Name |
|------------------|----------------------|
| `~/.claude` (default) | `Claude Code-credentials` |
| Any other directory | `Claude Code-credentials-{sha256prefix}` |

The `sha256prefix` is the **first 8 characters** of the SHA256 hash of the **expanded** config directory path.

### Examples

```
~/.claude    → "Claude Code-credentials"
~/.claude2   → "Claude Code-credentials-2b2c45df"
~/.claude3   → "Claude Code-credentials-6a46c118"
```

### Computing the Hash

```bash
# For ~/.claude2 (replace YOUR_USERNAME with your actual username):
echo -n "/Users/YOUR_USERNAME/.claude2" | shasum -a 256 | cut -c1-8
# Output: (8-character hex string, unique to your path)

# For ~/.claude3:
echo -n "/Users/YOUR_USERNAME/.claude3" | shasum -a 256 | cut -c1-8
# Output: (8-character hex string, unique to your path)
```

**Important**: Use the fully expanded path (no `~`), and use `echo -n` (no trailing newline).

## Keychain Entry Contents

Each keychain entry stores a JSON object with this structure:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1769762397633,
    "scopes": [
      "user:inference",
      "user:mcp_servers",
      "user:profile",
      "user:sessions:claude_code"
    ],
    "subscriptionType": "pro",
    "rateLimitTier": "default_claude_ai"
  }
}
```

### Reading from Keychain

```bash
# Read the default account token:
security find-generic-password -s "Claude Code-credentials" -w

# Read a specific account token:
security find-generic-password -s "Claude Code-credentials-2b2c45df" -w

# Pretty print the JSON:
security find-generic-password -s "Claude Code-credentials" -w | python3 -m json.tool
```

## Account Configuration Files

Each account also has a `.claude.json` config file that stores account metadata:

| Account | Config File Location |
|---------|---------------------|
| Default (`~/.claude`) | `~/.claude.json` |
| Custom (`~/.claude2`) | `~/.claude2/.claude.json` |
| Custom (`~/.claude3`) | `~/.claude3/.claude.json` |

The config file contains an `oauthAccount` object:

```json
{
  "oauthAccount": {
    "accountUuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "emailAddress": "your-email@example.com",
    "organizationUuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "displayName": "Your Name",
    "organizationRole": "admin"
  }
}
```

## Example Setup

| Account | Config Dir | Keychain Service | Email |
|---------|-----------|------------------|-------|
| main | `~/.claude` | `Claude Code-credentials` | user@example.com |
| account2 | `~/.claude2` | `Claude Code-credentials-{hash}` | user2@example.com |
| account3 | `~/.claude3` | `Claude Code-credentials-{hash}` | user3@example.com |

*Note: The `{hash}` is computed from your specific home directory path. Run `hub --usage` to see your actual keychain service names.*

## Adding a New Account

### Step 1: Create the Config Directory

```bash
mkdir ~/.claude4
```

### Step 2: Compute the Keychain Service Name (Optional - for debugging)

```bash
# Get the SHA256 prefix for the new directory (replace YOUR_USERNAME)
echo -n "/Users/YOUR_USERNAME/.claude4" | shasum -a 256 | cut -c1-8
# Example output: a1b2c3d4
# So the service name will be: Claude Code-credentials-a1b2c3d4
```

*Note: You don't need to compute this manually. Claude Code creates the keychain entry automatically when you authenticate.*

### Step 3: Authenticate with Claude

```bash
# Run Claude with the new config directory
CLAUDE_CONFIG_DIR=~/.claude4 claude

# Follow the login prompts to authenticate with your 4th account
# This will create the keychain entry automatically
```

### Step 4: Update claude-hub Config

Edit `config.json` to add the new account:

```json
{
  "accounts": {
    "main": "~/.claude",
    "account2": "~/.claude2",
    "account3": "~/.claude3",
    "account4": "~/.claude4"
  },
  "masterFolder": "~/.claude-hub-master",
  "syncOnStart": true
}
```

*Note: You can name accounts whatever you like (e.g., "work", "personal", "testing").*

### Step 5: Verify

```bash
# Build and test
npm run build

# Check keychain service names
node dist/usage/api.js keys

# Fetch usage for all accounts
node dist/usage/api.js all
```

## Usage API

Claude-hub fetches real usage data from Anthropic's API:

```
GET https://api.anthropic.com/api/oauth/usage
Headers:
  Authorization: Bearer {accessToken}
  Content-Type: application/json
  anthropic-beta: oauth-2025-04-20
```

### Response Format

```json
{
  "five_hour": {
    "utilization": 45.5,
    "resets_at": "2026-01-30T04:59:59.683576+00:00"
  },
  "seven_day": {
    "utilization": 28.0,
    "resets_at": "2026-02-05T23:59:59.683594+00:00"
  },
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null,
    "utilization": null
  }
}
```

- `utilization` is a percentage (0-100) of **used** capacity
- `resets_at` is an ISO 8601 timestamp

## Troubleshooting

### Token Not Found

If you get "Not logged in" errors:

```bash
# Re-authenticate for that account
CLAUDE_CONFIG_DIR=~/.claude2 claude
# Just starting Claude will refresh the token
```

### Token Expired (401 Error)

If API calls fail with 401:

```bash
# Run any Claude command to refresh the token
CLAUDE_CONFIG_DIR=~/.claude2 claude --version
```

### View All Claude Keychain Entries

```bash
security dump-keychain ~/Library/Keychains/login.keychain-db 2>/dev/null | grep -A 5 "Claude Code-credentials"
```

## Code Reference

The keychain service name computation in TypeScript:

```typescript
import { createHash } from 'crypto';

function getKeychainServiceName(configDir: string): string {
  const expandedPath = expandPath(configDir);  // e.g., "/Users/yourname/.claude2"
  const homeDir = process.env.HOME || '';
  const defaultDir = `${homeDir}/.claude`;

  // Default ~/.claude uses base service name
  if (expandedPath === defaultDir) {
    return 'Claude Code-credentials';
  }

  // Other directories use SHA256-based suffix
  const hash = createHash('sha256').update(expandedPath).digest('hex');
  const suffix = hash.substring(0, 8);

  return `Claude Code-credentials-${suffix}`;
}
```

## Credits

This approach was discovered by examining:
- [cc-usage](https://github.com/aromanarguello/cc-usage) - A menu bar app for tracking Claude usage
- Reddit discussion about Claude Code's OAuth token storage
