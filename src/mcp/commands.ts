/**
 * MCP Subcommands
 *
 * Proxies `hub mcp add/remove/list` to `claude mcp` with CLAUDE_CONFIG_DIR
 * set to the master folder. After add/remove, auto-syncs to all accounts.
 */

import { spawnSync } from 'child_process';
import { Config } from '../config';
import { syncMcp } from '../sync/mcp';
import { ensureDir } from '../utils/files';

/**
 * Handle `hub mcp <subcommand> [args...]`
 */
export function handleMcpCommand(mcpArgs: string[], config: Config, verbose: boolean): void {
  const subcommand = mcpArgs[0];

  if (!subcommand) {
    showMcpHelp();
    return;
  }

  switch (subcommand) {
    case 'add':
    case 'remove':
      handleAddRemove(mcpArgs, config, verbose);
      break;
    case 'list':
      handleList(config);
      break;
    default:
      console.error(`Unknown mcp subcommand: ${subcommand}`);
      showMcpHelp();
      process.exit(1);
  }
}

/**
 * Handle `hub mcp add` and `hub mcp remove`.
 * Forces --scope user and targets the master folder.
 */
function handleAddRemove(mcpArgs: string[], config: Config, verbose: boolean): void {
  // Ensure master folder exists before spawning claude
  ensureDir(config.masterFolder);

  // Build args: inject --scope user before any -- separator
  const cleanedArgs = removeScope(mcpArgs);
  const claudeArgs = injectScope(cleanedArgs);

  const result = spawnSync('claude', claudeArgs, {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_CONFIG_DIR: config.masterFolder },
  });

  if (result.error) {
    console.error(`Failed to run claude: ${result.error.message}`);
    console.error('Make sure claude is installed and in your PATH.');
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  // Auto-sync to all accounts
  console.log('');
  const stats = syncMcp(config, verbose);
  console.log(`✓ MCP server synced to ${stats.accountsUpdated} account(s)`);
}

/**
 * Handle `hub mcp list`. Targets master folder.
 */
function handleList(config: Config): void {
  console.log('MCP servers (from master config, synced to all accounts):');
  console.log('');

  const result = spawnSync('claude', ['mcp', 'list'], {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_CONFIG_DIR: config.masterFolder },
  });

  if (result.error) {
    console.error(`Failed to run claude: ${result.error.message}`);
    process.exit(1);
  }
}

/**
 * Remove any existing --scope/-s flags and their values from args.
 * We always force --scope user.
 */
function removeScope(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope' || args[i] === '-s') {
      i++; // Skip the value too
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

/**
 * Inject --scope user into args, placing it before any -- separator.
 * Returns the full claude args array starting with ['mcp', ...].
 */
function injectScope(args: string[]): string[] {
  const dashDashIndex = args.indexOf('--');
  if (dashDashIndex === -1) {
    // No -- separator, just append
    return ['mcp', ...args, '--scope', 'user'];
  }
  // Insert --scope user before the --
  const before = args.slice(0, dashDashIndex);
  const after = args.slice(dashDashIndex);
  return ['mcp', ...before, '--scope', 'user', ...after];
}

function showMcpHelp(): void {
  console.log(`
Claude Hub - MCP Server Management

Usage:
  hub mcp add <name> [args]     Add MCP server (synced to all accounts)
  hub mcp remove <name>         Remove MCP server from all accounts
  hub mcp list                  List MCP servers

All flags from \`claude mcp add\` are supported:
  -e, --env <KEY=value>         Set environment variables
  -t, --transport <type>        Transport type (stdio, sse, http)
  -H, --header <header>         Set headers (for http/sse)
  --callback-port <port>        Fixed port for OAuth callback
  --client-id <clientId>        OAuth client ID

Examples:
  hub mcp add codex-cli -- npx -y codex-mcp-server
  hub mcp add -e API_KEY=xxx my-server -- npx my-mcp-server
  hub mcp add --transport http sentry https://mcp.sentry.dev/mcp
  hub mcp remove codex-cli
  hub mcp list

MCP servers are stored in the master folder and synced to all accounts
on every \`hub\` run or \`hub mcp add/remove\`.
`);
}
