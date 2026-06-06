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
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
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
}
