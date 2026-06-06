/**
 * Integration tests for Windows credential access
 *
 * These tests run actual system commands and require:
 * 1. Running on Windows (win32)
 * 2. Claude Code to be installed and logged in (for credential tests)
 *
 * Tests are skipped on non-Windows platforms.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const isWindows = process.platform === 'win32';

describe('Windows Integration', () => {
  beforeAll(() => {
    if (!isWindows) {
      console.log('Skipping Windows tests on non-Windows platform');
    }
  });

  describe('where.exe command', () => {
    const skipIfNotWindows = isWindows ? test : test.skip;

    skipIfNotWindows('where.exe resolves claude command', () => {
      try {
        const result = execSync('where.exe claude', { encoding: 'utf-8' });
        const firstLine = result.trim().split(/\r?\n/)[0];
        expect(firstLine).toBeTruthy();
        expect(firstLine.toLowerCase()).toMatch(/claude/);
        console.log(`  Claude found at: ${firstLine}`);
      } catch {
        // Claude not installed - this is OK, just skip
        console.log('  Claude CLI not installed, skipping');
      }
    });

    skipIfNotWindows('where.exe resolves common commands', () => {
      const result = execSync('where.exe cmd', { encoding: 'utf-8' });
      const firstLine = result.trim().split(/\r?\n/)[0];
      expect(firstLine).toBeTruthy();
      expect(firstLine.toLowerCase()).toMatch(/cmd\.exe/);
    });

    skipIfNotWindows('where.exe resolves node', () => {
      const result = execSync('where.exe node', { encoding: 'utf-8' });
      const firstLine = result.trim().split(/\r?\n/)[0];
      expect(firstLine).toBeTruthy();
      expect(firstLine.toLowerCase()).toMatch(/node/);
    });

    skipIfNotWindows('where.exe returns multiple lines when applicable', () => {
      // node might be in multiple places
      const result = execSync('where.exe node', { encoding: 'utf-8' });
      const lines = result.trim().split(/\r?\n/);
      // At least one result
      expect(lines.length).toBeGreaterThanOrEqual(1);
      console.log(`  Found ${lines.length} node location(s)`);
    });
  });

  describe('.credentials.json file', () => {
    const skipIfNotWindows = isWindows ? test : test.skip;
    const homeDir = os.homedir();
    const defaultCredentialsPath = path.join(homeDir, '.claude', '.credentials.json');

    skipIfNotWindows('credentials file exists for logged-in account', () => {
      if (!fs.existsSync(defaultCredentialsPath)) {
        console.log('  No credentials file found (not logged in)');
        return;
      }

      const content = fs.readFileSync(defaultCredentialsPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data).toBeDefined();
      expect(data.claudeAiOauth).toBeDefined();
      expect(data.claudeAiOauth.accessToken).toBeTruthy();

      console.log('  Successfully read credentials from file');
      console.log(`  Token starts with: ${data.claudeAiOauth.accessToken.substring(0, 10)}...`);
    });

    skipIfNotWindows('credentials file has expected structure', () => {
      if (!fs.existsSync(defaultCredentialsPath)) {
        console.log('  No credentials file found (not logged in), skipping structure check');
        return;
      }

      const content = fs.readFileSync(defaultCredentialsPath, 'utf-8');
      const data = JSON.parse(content);

      // Check structure matches what we expect
      expect(data.claudeAiOauth).toHaveProperty('accessToken');
      expect(data.claudeAiOauth).toHaveProperty('refreshToken');
      expect(data.claudeAiOauth).toHaveProperty('expiresAt');
      expect(typeof data.claudeAiOauth.accessToken).toBe('string');
      expect(typeof data.claudeAiOauth.refreshToken).toBe('string');
      expect(typeof data.claudeAiOauth.expiresAt).toBe('number');
    });
  });

  describe('os.homedir()', () => {
    const skipIfNotWindows = isWindows ? test : test.skip;

    skipIfNotWindows('returns valid Windows home directory', () => {
      const homeDir = os.homedir();
      expect(homeDir).toBeTruthy();
      // Windows home dirs typically start with C:\Users\
      expect(homeDir).toMatch(/^[A-Za-z]:\\/);
      console.log(`  Home directory: ${homeDir}`);
    });

    skipIfNotWindows('os.homedir() works even if HOME env var is not set', () => {
      // Save current HOME
      const originalHome = process.env.HOME;

      // Temporarily unset HOME
      delete process.env.HOME;

      // os.homedir() should still work on Windows
      const homeDir = os.homedir();
      expect(homeDir).toBeTruthy();
      expect(homeDir).toMatch(/^[A-Za-z]:\\/);

      // Restore HOME
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      }
    });
  });
});
