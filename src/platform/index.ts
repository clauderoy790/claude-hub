/**
 * Platform abstraction layer
 *
 * Exports the correct platform implementation based on the current OS.
 * Currently supports macOS and Windows.
 */

import { Platform } from './types';
import { macPlatform } from './mac';
import { windowsPlatform } from './windows';

function getPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return macPlatform;
    case 'win32':
      return windowsPlatform;
    default:
      throw new Error(
        `Unsupported platform: ${process.platform}. ` +
        `Claude Hub currently supports macOS and Windows only.`
      );
  }
}

/** The platform implementation for the current OS */
export const platform = getPlatform();

/** Re-export types for convenience */
export type { Platform, CredentialData } from './types';
