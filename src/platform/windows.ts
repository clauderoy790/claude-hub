/**
 * Windows Platform Implementation
 *
 * Credentials: Reads OAuth tokens from .credentials.json file in config directory
 * Command resolution: Uses `where.exe` to find command paths
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Platform, CredentialData } from './types';
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

      if (!data.claudeAiOauth?.accessToken) {
        throw new Error('OAuth token not found in credentials file');
      }

      return data;
    } catch (err) {
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
}

export const windowsPlatform = new WindowsPlatform();
