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
import { Platform, CredentialData } from './types';
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

  resolveCommand(command: string): string {
    try {
      const fullPath = execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
      return fullPath || command;
    } catch {
      return command;
    }
  }
}

export const macPlatform = new MacPlatform();
