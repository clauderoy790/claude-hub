/**
 * Windows Platform Implementation
 *
 * Credentials: Reads OAuth tokens from .credentials.json file in config directory
 * Command resolution: Uses `where.exe` to find command paths
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Platform, CredentialData, LoggedOutError, BrowserScript } from './types';
import { expandPath } from '../utils/files';

export class WindowsPlatform implements Platform {
  readonly name = 'windows' as const;

  /**
   * Get the path to the credentials file for a config directory
   */
  private getCredentialsPath(configDir: string): string {
    const expandedPath = expandPath(configDir);
    return path.join(expandedPath, '.credentials.json');
  }

  getCredentials(configDir: string): CredentialData {
    const credentialsPath = this.getCredentialsPath(configDir);

    try {
      if (!fs.existsSync(credentialsPath)) {
        throw new Error(`Not logged in for ${configDir}. Run \`claude\` with that config to authenticate.`);
      }

      const content = fs.readFileSync(credentialsPath, 'utf-8');
      const data = JSON.parse(content) as CredentialData;

      // An empty (not missing) token means Claude Code blanked the credential
      // after a failed refresh — that's a logout, not a malformed file.
      if (data.claudeAiOauth && data.claudeAiOauth.accessToken === '') {
        throw new LoggedOutError(configDir);
      }

      if (!data.claudeAiOauth?.accessToken) {
        throw new Error('OAuth token not found in credentials file');
      }

      return data;
    } catch (err) {
      if (err instanceof LoggedOutError) {
        throw err;
      }
      if (err instanceof Error) {
        if (err.message.includes('Not logged in') || err.message.includes('OAuth token not found')) {
          throw err;
        }
      }
      throw new Error(`Failed to read credentials for ${configDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  resolveCommand(command: string): string {
    try {
      const result = execSync(`where.exe ${command}`, { encoding: 'utf-8' });
      // where.exe can return multiple lines, take the first one
      const firstLine = result.trim().split(/\r?\n/)[0];
      return firstLine || command;
    } catch {
      return command;
    }
  }

  chromeUserDataDir(): string {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    return path.join(localAppData, 'Google', 'Chrome', 'User Data');
  }

  closeLoginTabs(): void {
    // Windows has no scripting equivalent to Chrome's AppleScript support, so the
    // finished login tabs stay open. Harmless — just not tidied automatically.
  }

  browserProfileScript(profileDirectory: string): BrowserScript {
    // `start` resolves chrome.exe through the App Paths registry key, so Chrome
    // doesn't need to be on PATH. The empty "" is start's window-title argument.
    return {
      fileName: 'open-profile.cmd',
      contents: [
        '@echo off',
        'REM Written by claude-hub. Opens a URL in a specific Chrome profile.',
        `start "" chrome.exe --profile-directory="${profileDirectory}" %1`,
        '',
      ].join('\r\n'),
      mode: 0o755,
    };
  }
}

export const windowsPlatform = new WindowsPlatform();
