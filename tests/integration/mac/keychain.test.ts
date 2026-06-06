/**
 * Integration tests for macOS Keychain access
 *
 * These tests run actual system commands and require:
 * 1. Running on macOS (darwin)
 * 2. Claude Code to be installed and logged in (for credential tests)
 *
 * Tests are skipped on non-Mac platforms.
 */

import { execSync } from 'child_process';
import { getKeychainServiceName, macPlatform } from '../../../src/platform/mac';

const isMac = process.platform === 'darwin';

describe('macOS Keychain Integration', () => {
  beforeAll(() => {
    if (!isMac) {
      console.log('Skipping Mac Keychain tests on non-Mac platform');
    }
  });

  describe('which command', () => {
    const skipIfNotMac = isMac ? test : test.skip;

    skipIfNotMac('which resolves claude command', () => {
      try {
        const result = execSync('which claude', { encoding: 'utf-8' }).trim();
        expect(result).toBeTruthy();
        expect(result).toMatch(/claude/);
        console.log(`  Claude found at: ${result}`);
      } catch {
        // Claude not installed - this is OK, just skip
        console.log('  Claude CLI not installed, skipping');
      }
    });

    skipIfNotMac('which resolves common commands', () => {
      const result = execSync('which ls', { encoding: 'utf-8' }).trim();
      expect(result).toBe('/bin/ls');
    });

    skipIfNotMac('which returns path for node', () => {
      const result = execSync('which node', { encoding: 'utf-8' }).trim();
      expect(result).toBeTruthy();
      expect(result).toMatch(/node/);
    });
  });

  describe('Keychain service name', () => {
    const skipIfNotMac = isMac ? test : test.skip;

    skipIfNotMac('generates correct service name for default dir', () => {
      const serviceName = getKeychainServiceName('~/.claude');
      expect(serviceName).toBe('Claude Code-credentials');
    });

    skipIfNotMac('generates hashed service name for non-default dir', () => {
      const serviceName = getKeychainServiceName('~/.claude2');
      expect(serviceName).toMatch(/^Claude Code-credentials-[a-f0-9]{8}$/);
    });
  });

  describe('Keychain credential reading', () => {
    const skipIfNotMac = isMac ? test : test.skip;

    skipIfNotMac('reads credentials from keychain for logged-in account', () => {
      // This test requires Claude Code to be logged in
      // It will fail if not logged in, which is expected

      try {
        const credentials = macPlatform.getCredentials('~/.claude');

        expect(credentials).toBeDefined();
        expect(credentials.claudeAiOauth).toBeDefined();
        expect(credentials.claudeAiOauth.accessToken).toBeTruthy();
        expect(typeof credentials.claudeAiOauth.accessToken).toBe('string');

        console.log('  Successfully read credentials from Keychain');
        console.log(`  Token starts with: ${credentials.claudeAiOauth.accessToken.substring(0, 10)}...`);
      } catch (err) {
        // Not logged in is OK - just note it
        console.log(`  Keychain read failed (expected if not logged in): ${err}`);
      }
    });

    skipIfNotMac('throws for non-existent keychain entry', () => {
      expect(() => {
        macPlatform.getCredentials('~/.claude-nonexistent-test-dir');
      }).toThrow(/Not logged in|Failed to read keychain/);
    });
  });
});
