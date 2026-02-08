/**
 * MCP Server Sync
 *
 * Syncs MCP (Model Context Protocol) servers from master folder to all accounts.
 * Reads the top-level `mcpServers` key from master's .claude.json and merges
 * just that key into each account's .claude.json, preserving all other data.
 *
 * Master folder is the single source of truth (one-way sync).
 */

import * as fs from 'fs';
import { Config } from '../config';
import { getClaudeConfigPath } from '../utils/files';

export interface McpSyncStats {
  serversSynced: number;
  accountsUpdated: number;
}

/**
 * Read and parse a .claude.json file, returning the parsed object.
 * Returns null if file doesn't exist or is malformed.
 */
function readClaudeConfig(configPath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write a .claude.json file with consistent formatting.
 */
function writeClaudeConfig(configPath: string, data: Record<string, any>): void {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

/**
 * Sync MCP servers from master folder to all accounts.
 * Only touches the top-level `mcpServers` key — never modifies
 * projects[*].mcpServers or any other account-specific data.
 */
export function syncMcp(config: Config, verbose: boolean = false): McpSyncStats {
  const stats: McpSyncStats = { serversSynced: 0, accountsUpdated: 0 };

  if (verbose) {
    console.log('Syncing MCP servers (master -> accounts)...');
  }

  // Read master's .claude.json
  const masterConfigPath = getClaudeConfigPath(config.masterFolder);
  const masterData = readClaudeConfig(masterConfigPath);

  if (!masterData || !masterData.mcpServers) {
    if (verbose) {
      console.log('  No MCP servers configured in master');
    }
    return stats;
  }

  const masterServers = masterData.mcpServers;
  stats.serversSynced = Object.keys(masterServers).length;

  // Sync to each account
  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    const accountConfigPath = getClaudeConfigPath(accountPath);
    const accountData = readClaudeConfig(accountConfigPath);

    if (!accountData) {
      if (verbose) {
        console.log(`  [skip] ${accountName} — no .claude.json found`);
      }
      continue;
    }

    // Compare current mcpServers with master's (JSON stringify for deep equality)
    const currentServers = accountData.mcpServers || {};
    if (JSON.stringify(currentServers) === JSON.stringify(masterServers)) {
      if (verbose) {
        console.log(`  [ok] ${accountName} — already in sync`);
      }
      continue;
    }

    // Update only the mcpServers key, preserve everything else
    accountData.mcpServers = masterServers;

    try {
      writeClaudeConfig(accountConfigPath, accountData);
      stats.accountsUpdated++;

      if (verbose) {
        console.log(`  [updated] ${accountName} — ${stats.serversSynced} server(s)`);
      }
    } catch (err) {
      if (verbose) {
        console.log(`  [error] ${accountName} — failed to write: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (verbose) {
    console.log(`\nMCP sync complete: ${stats.serversSynced} server(s) across ${stats.accountsUpdated} account(s) updated`);
  }

  return stats;
}

/**
 * List MCP servers for debugging
 */
export function listMcpServers(config: Config): void {
  console.log('\nMCP Servers:\n');

  // Master
  const masterConfigPath = getClaudeConfigPath(config.masterFolder);
  const masterData = readClaudeConfig(masterConfigPath);
  const masterServers = masterData?.mcpServers || {};
  const serverNames = Object.keys(masterServers);

  console.log('Master:');
  if (serverNames.length === 0) {
    console.log('  (none)');
  } else {
    for (const name of serverNames) {
      const server = masterServers[name];
      const type = server.type || 'stdio';
      const cmd = server.command || server.url || '';
      console.log(`  - ${name} (${type}: ${cmd})`);
    }
  }

  // Accounts
  console.log('\nAccounts:');
  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    const accountConfigPath = getClaudeConfigPath(accountPath);
    const accountData = readClaudeConfig(accountConfigPath);
    const accountServers = accountData?.mcpServers || {};
    const count = Object.keys(accountServers).length;
    const inSync = JSON.stringify(accountServers) === JSON.stringify(masterServers);

    console.log(`  ${accountName}: ${count} server(s)${inSync ? ' (in sync)' : ' (out of sync)'}`);
  }
}
