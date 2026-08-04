/**
 * Platform abstraction types
 *
 * Defines the interface for platform-specific operations.
 * Currently implemented for macOS and Windows.
 * To add Linux support, create linux.ts implementing this interface.
 */

export interface CredentialData {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    /**
     * When the login itself expires (~30 days, anchored at /login — refreshing
     * does not extend it). Absent on credentials last written by an older CLI.
     */
    refreshTokenExpiresAt?: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

/**
 * Thrown when a credential exists but has been blanked out.
 *
 * Claude Code clears the token fields in place (rather than deleting the entry)
 * when a refresh comes back invalid_grant, so this is the normal "logged out"
 * state, distinct from never having logged in at all.
 */
export class LoggedOutError extends Error {
  constructor(configDir: string) {
    super(`Logged out for ${configDir}. Run \`hub login <account>\` to sign in again.`);
    this.name = 'LoggedOutError';
  }
}

export interface Platform {
  /** Platform name for display/logging */
  readonly name: 'macos' | 'windows';

  /**
   * Get OAuth credentials for a config directory
   * @param configDir - Path to config directory (e.g., "~/.claude" or "~/.claude2")
   * @throws Error if credentials not found or invalid
   */
  getCredentials(configDir: string): CredentialData;

  /**
   * Resolve full path to a command
   * @param command - Command name (e.g., "claude")
   * @returns Full path to the command, or the original command if not found
   */
  resolveCommand(command: string): string;

  /**
   * Absolute path to Chrome's user-data directory, where `Local State` lists
   * the installed profiles.
   */
  chromeUserDataDir(): string;

  /**
   * Build a wrapper script that opens a URL in a specific Chrome profile.
   *
   * Claude Code opens the browser by spawning `$BROWSER <url>`, so pointing
   * BROWSER at this script sends the whole login flow to the right profile.
   *
   * @param profileDirectory - Chrome profile dir name (e.g., "Default", "Profile 2")
   */
  browserProfileScript(profileDirectory: string): BrowserScript;

  /**
   * Close leftover OAuth tabs after a successful login, and quit the browser if
   * that leaves it with nothing open.
   *
   * The login flow leaves a "Sign in" tab and a "Sign in successful" tab behind,
   * which are pure litter once the token is stored. Best-effort: does nothing if
   * the platform can't drive the browser, or if permission is refused.
   */
  closeLoginTabs(): void;
}

export interface BrowserScript {
  /** File name to write the script as (extension matters on Windows) */
  fileName: string;
  contents: string;
  /** chmod mode for the written file */
  mode: number;
}
