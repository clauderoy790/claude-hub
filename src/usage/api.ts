/**
 * Usage API - Fetches real usage data directly from Anthropic's API
 *
 * Uses OAuth token from macOS Keychain to call the usage endpoint.
 * This gives actual usage percentages (vs ccusage which estimates from local files).
 *
 * Key discovery: Claude Code stores OAuth tokens with config-dir-specific keychain entries:
 * - Default (~/.claude): "Claude Code-credentials"
 * - Other dirs: "Claude Code-credentials-{sha256prefix}"
 *   where sha256prefix = first 8 chars of SHA256(expanded_config_path)
 */

import { execSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { expandPath } from '../utils/files';

// ============================================================================
// Interfaces
// ============================================================================

/** Raw API response from Anthropic's usage endpoint */
export interface UsageAPIResponse {
  five_hour: UsageWindowResponse;
  seven_day: UsageWindowResponse;
  seven_day_sonnet?: UsageWindowResponse | null;
  seven_day_opus?: UsageWindowResponse | null;
  seven_day_oauth_apps?: UsageWindowResponse | null;
  seven_day_cowork?: UsageWindowResponse | null;
  extra_usage?: ExtraUsageResponse | null;
}

export interface UsageWindowResponse {
  utilization: number;  // Percentage 0-100
  resets_at: string;    // ISO 8601 datetime
}

export interface ExtraUsageResponse {
  utilization?: number | null;
  used_credits?: number | null;
  monthly_limit?: number | null;
  is_enabled: boolean;
}

/** Parsed usage data for an account */
export interface APIUsageData {
  accountName: string;
  emailAddress?: string;

  // 5-hour session window
  fiveHourUsed: number;       // Percentage used (0-100)
  fiveHourRemaining: number;  // Percentage remaining (0-100)
  fiveHourResetsAt: Date;
  fiveHourResetFormatted: string;

  // 7-day weekly window
  sevenDayUsed: number;       // Percentage used (0-100)
  sevenDayRemaining: number;  // Percentage remaining (0-100)
  sevenDayResetsAt: Date;
  sevenDayResetFormatted: string;

  // Extra usage (if enabled)
  extraUsage?: ExtraUsageData;

  // Debug info
  raw?: UsageAPIResponse;
  error?: string;
}

export interface ExtraUsageData {
  utilization: number;    // Percentage of extra budget used
  usedCredits: number;    // In cents
  monthlyLimit: number;   // In cents
  usedUSD: string;        // Formatted as "$X.XX"
  limitUSD: string;       // Formatted as "$X.XX"
  isEnabled: boolean;
}

/** Keychain token data structure */
interface KeychainData {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

/** Account info from .claude.json */
interface OAuthAccountInfo {
  accountUuid: string;
  emailAddress: string;
  organizationUuid: string;
  displayName: string;
}

// ============================================================================
// Constants
// ============================================================================

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const API_BETA_HEADER = 'oauth-2025-04-20';
const KEYCHAIN_SERVICE_BASE = 'Claude Code-credentials';
const DEFAULT_CLAUDE_DIR = '.claude';

// ============================================================================
// Keychain Functions
// ============================================================================

/**
 * Compute the keychain service name for a config directory
 *
 * Claude Code stores OAuth tokens in keychain with directory-specific names:
 * - Default (~/.claude): "Claude Code-credentials"
 * - Other dirs: "Claude Code-credentials-{sha256prefix}"
 *
 * The sha256prefix is the first 8 characters of SHA256(expanded_config_path)
 *
 * @param configDir - Path to config directory (e.g., "~/.claude2")
 * @returns Keychain service name
 */
export function getKeychainServiceName(configDir: string): string {
  const expandedPath = expandPath(configDir);
  const homeDir = process.env.HOME || '';
  const defaultDir = path.join(homeDir, DEFAULT_CLAUDE_DIR);

  // Default ~/.claude uses the base service name
  if (expandedPath === defaultDir) {
    return KEYCHAIN_SERVICE_BASE;
  }

  // Other directories use a SHA256-based suffix
  const hash = createHash('sha256').update(expandedPath).digest('hex');
  const suffix = hash.substring(0, 8);

  return `${KEYCHAIN_SERVICE_BASE}-${suffix}`;
}

/**
 * Read OAuth token from macOS Keychain for a specific config directory
 */
export function getOAuthTokenFromKeychain(configDir: string): KeychainData {
  const serviceName = getKeychainServiceName(configDir);

  try {
    const result = execSync(
      `security find-generic-password -s "${serviceName}" -w`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const data = JSON.parse(result.trim()) as KeychainData;

    if (!data.claudeAiOauth?.accessToken) {
      throw new Error('OAuth token not found in keychain data');
    }

    return data;
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('could not be found')) {
        throw new Error(`Not logged in for ${configDir}. Run \`claude\` with that config to authenticate.`);
      }
      if (err.message.includes('OAuth token not found')) {
        throw err;
      }
    }
    throw new Error(`Failed to read keychain for ${configDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// Account Info Functions
// ============================================================================

/**
 * Read account info from .claude.json in the config directory
 *
 * Note: For the default ~/.claude directory, the config is at ~/.claude.json
 * For other directories (e.g., ~/.claude2), the config is at ~/.claude2/.claude.json
 */
export function getAccountInfo(configDir: string): OAuthAccountInfo | null {
  try {
    const expandedPath = expandPath(configDir);
    const homeDir = process.env.HOME || '';
    const defaultDir = path.join(homeDir, DEFAULT_CLAUDE_DIR);

    // For default ~/.claude, config is at ~/.claude.json
    // For other dirs, config is at <dir>/.claude.json
    let configFile: string;
    if (expandedPath === defaultDir) {
      configFile = path.join(homeDir, '.claude.json');
    } else {
      configFile = path.join(expandedPath, '.claude.json');
    }

    const content = fs.readFileSync(configFile, 'utf-8');
    const config = JSON.parse(content);

    return config.oauthAccount || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Token Refresh Functions
// ============================================================================

/**
 * Refresh OAuth token by launching Claude CLI
 *
 * Claude refreshes expired tokens on startup, before processing any input.
 * We launch with stdin closed (/dev/null) which triggers the refresh but
 * exits immediately. This is fast and doesn't consume any API usage.
 *
 * NOTE: `claude --version` does NOT refresh tokens - it doesn't check auth.
 * NOTE: The command will "fail" with an error about needing input, but
 *       the token refresh still happens during startup.
 *
 * @param configDir - Path to config directory (e.g., "~/.claude2")
 * @returns true if refresh likely succeeded, false on spawn error
 */
export function refreshToken(configDir: string): boolean {
  const expandedPath = expandPath(configDir);
  const homeDir = process.env.HOME || '';
  const defaultDir = path.join(homeDir, DEFAULT_CLAUDE_DIR);

  // Build environment - only set CLAUDE_CONFIG_DIR for non-default dirs
  const env = { ...process.env };
  if (expandedPath !== defaultDir) {
    env.CLAUDE_CONFIG_DIR = expandedPath;
  }

  try {
    // Launch claude with stdin from /dev/null
    // This triggers token refresh on startup, then exits immediately
    // The command will exit with error (no input) but token is refreshed
    spawnSync('claude', [], {
      env,
      encoding: 'utf-8',
      timeout: 30000, // 30 second timeout
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored = /dev/null
    });

    // We don't check exit status because the command "fails" due to no input,
    // but the token refresh still happens during startup
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch usage data from the Anthropic API
 */
export function fetchUsageFromAPI(accessToken: string): Promise<UsageAPIResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(USAGE_API_URL);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-beta': API_BETA_HEADER,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data) as UsageAPIResponse;
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Failed to parse API response: ${err}`));
          }
        } else if (res.statusCode === 401) {
          reject(new Error('Token expired. Run `claude` in terminal to refresh.'));
        } else {
          reject(new Error(`API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });

    req.end();
  });
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format time until reset in human-readable form
 */
function formatTimeUntilReset(resetDate: Date): string {
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs <= 0) return 'Now';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Parse API response into our typed structure
 */
function parseAPIResponse(accountName: string, response: UsageAPIResponse, email?: string): APIUsageData {
  const fiveHourResetDate = new Date(response.five_hour.resets_at);
  const sevenDayResetDate = new Date(response.seven_day.resets_at);

  const result: APIUsageData = {
    accountName,
    emailAddress: email,
    fiveHourUsed: Math.round(response.five_hour.utilization),
    fiveHourRemaining: Math.round(100 - response.five_hour.utilization),
    fiveHourResetsAt: fiveHourResetDate,
    fiveHourResetFormatted: formatTimeUntilReset(fiveHourResetDate),
    sevenDayUsed: Math.round(response.seven_day.utilization),
    sevenDayRemaining: Math.round(100 - response.seven_day.utilization),
    sevenDayResetsAt: sevenDayResetDate,
    sevenDayResetFormatted: formatTimeUntilReset(sevenDayResetDate),
    raw: response,
  };

  // Parse extra usage if available
  if (response.extra_usage?.is_enabled) {
    const usedCents = response.extra_usage.used_credits ?? 0;
    const limitCents = response.extra_usage.monthly_limit ?? 0;

    result.extraUsage = {
      utilization: response.extra_usage.utilization ?? 0,
      usedCredits: usedCents,
      monthlyLimit: limitCents,
      usedUSD: `$${(usedCents / 100).toFixed(2)}`,
      limitUSD: `$${(limitCents / 100).toFixed(2)}`,
      isEnabled: true,
    };
  }

  return result;
}

// ============================================================================
// Main Public Functions
// ============================================================================

/**
 * Get usage for a single account
 *
 * This function reads the OAuth token from the correct keychain entry
 * for the given config directory and makes the API call.
 *
 * If the token is expired (401), it automatically refreshes by running
 * `claude --version` and retries the API call.
 *
 * @param accountName - Display name for the account (e.g., "main", "work")
 * @param configDir - Path to the config directory (e.g., "~/.claude2")
 */
export async function getAPIUsage(accountName: string, configDir: string): Promise<APIUsageData> {
  // Get account email for display
  const accountInfo = getAccountInfo(configDir);
  const email = accountInfo?.emailAddress;

  const makeErrorResult = (errorMsg: string): APIUsageData => ({
    accountName,
    emailAddress: email,
    fiveHourUsed: 0,
    fiveHourRemaining: 100,
    fiveHourResetsAt: new Date(),
    fiveHourResetFormatted: 'Unknown',
    sevenDayUsed: 0,
    sevenDayRemaining: 100,
    sevenDayResetsAt: new Date(),
    sevenDayResetFormatted: 'Unknown',
    error: errorMsg,
  });

  try {
    // Read token from the config-dir-specific keychain entry
    let keychainData = getOAuthTokenFromKeychain(configDir);
    let token = keychainData.claudeAiOauth.accessToken;

    // Fetch usage from API
    try {
      const response = await fetchUsageFromAPI(token);
      return parseAPIResponse(accountName, response, email);
    } catch (apiErr) {
      // Check if this is a token expiry error (401)
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      if (errMsg.includes('Token expired') || errMsg.includes('401')) {
        // Try to refresh the token
        const refreshed = refreshToken(configDir);
        if (!refreshed) {
          return makeErrorResult('Token expired. Refresh failed.');
        }

        // Re-read the token from keychain (should be updated now)
        keychainData = getOAuthTokenFromKeychain(configDir);
        token = keychainData.claudeAiOauth.accessToken;

        // Retry the API call
        const response = await fetchUsageFromAPI(token);
        return parseAPIResponse(accountName, response, email);
      }

      // Not a token expiry error, re-throw
      throw apiErr;
    }
  } catch (err) {
    return makeErrorResult(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Get usage for all configured accounts
 *
 * Each account has its own keychain entry, so we can fetch in parallel!
 * Results are cached for USAGE_CACHE_SECONDS to avoid excessive API calls.
 */

// Cache configuration
const USAGE_CACHE_SECONDS = 30; // How long to cache usage data

// Cache state
let cachedUsageData: APIUsageData[] | null = null;
let lastFetchTime: number = 0;

export async function getAllAPIUsage(accounts: Record<string, string>): Promise<APIUsageData[]> {
  const now = Date.now();
  const cacheAgeSeconds = (now - lastFetchTime) / 1000;

  // Return cached data if still fresh AND no reset times are in the past
  if (cachedUsageData && cacheAgeSeconds < USAGE_CACHE_SECONDS) {
    // Check if any reset time is in the past (indicates stale data after a reset)
    const hasStaleResetTime = cachedUsageData.some(u =>
      !u.error && u.fiveHourResetsAt.getTime() < now
    );
    if (!hasStaleResetTime) {
      return cachedUsageData;
    }
    // Reset time in past = data is stale, refetch
  }

  // Fetch fresh data
  const promises = Object.entries(accounts).map(([name, configDir]) =>
    getAPIUsage(name, configDir)
  );

  const results = await Promise.all(promises);

  // Update cache
  cachedUsageData = results;
  lastFetchTime = now;

  return results;
}

/**
 * Clear the usage cache (useful for testing or forcing refresh)
 */
export function clearUsageCache(): void {
  cachedUsageData = null;
  lastFetchTime = 0;
}

/**
 * Check if cached usage data is available and fresh
 */
export function hasValidUsageCache(): boolean {
  if (!cachedUsageData) return false;
  const cacheAgeSeconds = (Date.now() - lastFetchTime) / 1000;
  return cacheAgeSeconds < USAGE_CACHE_SECONDS;
}

// ============================================================================
// Test Functions (for development/debugging)
// ============================================================================

/**
 * Test function - show keychain service names for configured accounts
 *
 * Run with: npm run build && node dist/usage/api.js keys
 *
 * Note: This uses example account names. In real usage, accounts come from config.json.
 */
export function testKeychainServiceNames(): void {
  console.log('=== Keychain Service Names ===\n');
  console.log('This test shows how keychain service names are computed.\n');

  // Example accounts for demonstration
  const exampleAccounts: Record<string, string> = {
    'main': '~/.claude',
    'account2': '~/.claude2',
  };

  for (const [name, configDir] of Object.entries(exampleAccounts)) {
    const expandedPath = expandPath(configDir);
    const serviceName = getKeychainServiceName(configDir);
    console.log(`${name} (${expandedPath})`);
    console.log(`  Service: ${serviceName}`);
    console.log('');
  }

  console.log('To test with your actual accounts, use: hub --usage');
}

/**
 * Test function - fetch usage for default account only
 *
 * Run with: npm run build && node dist/usage/api.js
 *
 * For testing all configured accounts, use: hub --usage
 */
export async function testCurrentUsage(): Promise<void> {
  console.log('=== Claude Usage API Test (Default Account) ===\n');

  const usage = await getAPIUsage('main', '~/.claude');

  if (usage.error) {
    console.log(`Error: ${usage.error}`);
  } else {
    console.log(`Email: ${usage.emailAddress || 'Unknown'}`);
    console.log(`5-hour: ${usage.fiveHourUsed}% used (${usage.fiveHourRemaining}% remaining)`);
    console.log(`  Resets in: ${usage.fiveHourResetFormatted}`);
    console.log(`7-day:  ${usage.sevenDayUsed}% used (${usage.sevenDayRemaining}% remaining)`);
    console.log(`  Resets in: ${usage.sevenDayResetFormatted}`);
  }

  console.log('\nTo test all configured accounts, use: hub --usage');
}

// Run test if this file is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('keys')) {
    testKeychainServiceNames();
  } else {
    testCurrentUsage();
  }
}
