/**
 * macOS Platform Implementation
 *
 * Credentials: Reads OAuth tokens from macOS Keychain using `security` command
 * Command resolution: Uses `which` to find command paths
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import * as path from 'path';
import * as os from 'os';
import { Platform, CredentialData, LoggedOutError, BrowserScript } from './types';
import { expandPath } from '../utils/files';

const KEYCHAIN_SERVICE_BASE = 'Claude Code-credentials';
const DEFAULT_CLAUDE_DIR = '.claude';

/**
 * Compute the keychain service name for a config directory
 *
 * Claude Code stores OAuth tokens in keychain with directory-specific names:
 * - Default (~/.claude): "Claude Code-credentials"
 * - Other dirs: "Claude Code-credentials-{sha256prefix}"
 *
 * The sha256prefix is the first 8 characters of SHA256(expanded_config_path)
 *
 * Exported for testing purposes.
 */
export function getKeychainServiceName(configDir: string): string {
  const expandedPath = expandPath(configDir);
  const homeDir = os.homedir();
  const defaultDir = path.join(homeDir, DEFAULT_CLAUDE_DIR);

  if (expandedPath === defaultDir) {
    return KEYCHAIN_SERVICE_BASE;
  }

  const hash = createHash('sha256').update(expandedPath).digest('hex');
  const suffix = hash.substring(0, 8);

  return `${KEYCHAIN_SERVICE_BASE}-${suffix}`;
}

export class MacPlatform implements Platform {
  readonly name = 'macos' as const;

  getCredentials(configDir: string): CredentialData {
    const serviceName = getKeychainServiceName(configDir);

    try {
      const result = execSync(
        `security find-generic-password -s "${serviceName}" -w`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

      const data = JSON.parse(result.trim()) as CredentialData;

      // An empty (not missing) token means Claude Code blanked the credential
      // after a failed refresh — that's a logout, not a malformed entry.
      if (data.claudeAiOauth && data.claudeAiOauth.accessToken === '') {
        throw new LoggedOutError(configDir);
      }

      if (!data.claudeAiOauth?.accessToken) {
        throw new Error('OAuth token not found in keychain data');
      }

      return data;
    } catch (err) {
      if (err instanceof LoggedOutError) {
        throw err;
      }
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

  resolveCommand(command: string): string {
    try {
      const fullPath = execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
      return fullPath || command;
    } catch {
      return command;
    }
  }

  chromeUserDataDir(): string {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }

  closeLoginTabs(): void {
    try {
      execSync(`osascript -e ${shellQuote(buildCloseLoginTabsScript())}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
    } catch {
      // Chrome not scriptable, or automation permission denied. The tabs just
      // stay open — never worth surfacing after a successful login.
    }
  }

  browserProfileScript(profileDirectory: string): BrowserScript {
    // -n forces a new instance so the URL lands in the requested profile even
    // when Chrome is already running under a different one.
    return {
      fileName: 'open-profile.sh',
      contents: [
        '#!/bin/sh',
        '# Written by claude-hub. Opens a URL in a specific Chrome profile.',
        `exec open -na "Google Chrome" --args --profile-directory=${shellQuote(profileDirectory)} "$1"`,
        '',
      ].join('\n'),
      mode: 0o755,
    };
  }
}

/** Single-quote a string for POSIX shells */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * URL fragments that only ever appear in a Claude Code OAuth login flow.
 * Deliberately specific — a plain claude.ai tab the user is working in must not match.
 */
const LOGIN_TAB_PATTERNS = [
  '/oauth/code/success',
  '/cai/oauth/authorize',
  '/oauth/authorize',
  'claude.ai/login',
];

/**
 * AppleScript that closes finished login tabs.
 *
 * Both loops run back-to-front. Closing a tab shifts the indexes of every tab
 * after it, and closing a window's last tab removes the window — so walking
 * forwards (or over a snapshot of `every window`) silently skips items once
 * anything closes.
 *
 * Exported for testing purposes.
 */
export function buildCloseLoginTabsScript(): string {
  const patterns = LOGIN_TAB_PATTERNS.map(p => `"${p}"`).join(', ');

  return `
tell application "Google Chrome"
  if it is not running then return
  set matchPatterns to {${patterns}}
  set wi to (count of windows)
  repeat while wi > 0
    try
      set i to (count of tabs of window wi)
      repeat while i > 0
        set tabUrl to URL of tab i of window wi
        repeat with p in matchPatterns
          if tabUrl contains p then
            close tab i of window wi
            exit repeat
          end if
        end repeat
        set i to i - 1
      end repeat
    end try
    set wi to wi - 1
  end repeat
  -- Nothing left means Chrome was only open to do the login, so don't leave it
  -- running with an empty dock icon. Anyone actually using Chrome still has
  -- windows here, and keeps their browser.
  if (count of windows) is 0 then quit
end tell`.trim();
}

export const macPlatform = new MacPlatform();
