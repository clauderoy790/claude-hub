/**
 * Usage API - Fetches real usage data directly from Anthropic's API
 *
 * Uses OAuth tokens to call the usage endpoint.
 * Token storage is platform-specific:
 * - macOS: Keychain
 * - Windows: .credentials.json file
 *
 * This gives actual usage percentages (vs ccusage which estimates from local files).
 */

import https from 'https';
import * as fs from 'fs';
import { getClaudeConfigPath } from '../utils/files';
import { platform, CredentialData } from '../platform';

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
    const configFile = getClaudeConfigPath(configDir);
    const content = fs.readFileSync(configFile, 'utf-8');
    const config = JSON.parse(content);

    return config.oauthAccount || null;
  } catch {
    return null;
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
          reject(new Error('token expired (refreshes on next use)'));
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
 * This function reads the OAuth token using the platform-specific method
 * (Keychain on macOS, .credentials.json on Windows) and makes the API call.
 *
 * Hub never refreshes tokens itself. Anthropic rotates refresh tokens on every
 * use, so a refresh started outside the Claude CLI (or interrupted partway) can
 * leave the CLI holding a superseded token, which the server then rejects with
 * invalid_grant — permanently logging the account out. Refreshing is left
 * entirely to `claude`, inside a session that owns the credential.
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
    // Read token using platform-specific method
    const credentials = platform.getCredentials(configDir);
    const token = credentials.claudeAiOauth.accessToken;

    const response = await fetchUsageFromAPI(token);
    return parseAPIResponse(accountName, response, email);
  } catch (err) {
    return makeErrorResult(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Get usage for all configured accounts
 *
 * Each account has its own credentials, so we can fetch in parallel!
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
 * Test function - fetch usage for default account only
 *
 * Run with: npm run build && node dist/usage/api.js
 *
 * For testing all configured accounts, use: hub --usage
 */
export async function testCurrentUsage(): Promise<void> {
  console.log(`=== Claude Usage API Test (${platform.name}) ===\n`);

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
  testCurrentUsage();
}
