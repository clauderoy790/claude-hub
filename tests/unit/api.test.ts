/**
 * Unit tests for src/usage/api.ts
 *
 * Tests API response parsing, time formatting, and keychain service name generation.
 * Uses mocking for system calls (keychain, file system).
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getAccountInfo } from '../../src/usage/api';
import { getKeychainServiceName } from '../../src/platform/mac';
import { expandPath } from '../../src/utils/files';

describe('getKeychainServiceName', () => {
  const homeDir = os.homedir();

  test('returns base service name for default ~/.claude', () => {
    const result = getKeychainServiceName('~/.claude');
    expect(result).toBe('Claude Code-credentials');
  });

  test('returns hashed service name for non-default directory', () => {
    const result = getKeychainServiceName('~/.claude2');
    // Should be "Claude Code-credentials-<8 char hash>"
    expect(result).toMatch(/^Claude Code-credentials-[a-f0-9]{8}$/);
  });

  test('different directories produce different hashes', () => {
    const result1 = getKeychainServiceName('~/.claude2');
    const result2 = getKeychainServiceName('~/.claude3');
    expect(result1).not.toBe(result2);
  });

  test('same directory always produces same hash', () => {
    const result1 = getKeychainServiceName('~/.claude-work');
    const result2 = getKeychainServiceName('~/.claude-work');
    expect(result1).toBe(result2);
  });

  test('expanded path produces same result as tilde path', () => {
    const expandedPath = path.join(homeDir, '.claude2');
    const result1 = getKeychainServiceName('~/.claude2');
    const result2 = getKeychainServiceName(expandedPath);
    expect(result1).toBe(result2);
  });
});

describe('getAccountInfo', () => {
  const testDir = path.join(os.tmpdir(), 'claude-hub-test-' + Date.now());
  const testConfigFile = path.join(testDir, '.claude.json');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(testConfigFile)) {
      fs.unlinkSync(testConfigFile);
    }
  });

  test('returns null when config file does not exist', () => {
    const result = getAccountInfo('/nonexistent/path');
    expect(result).toBeNull();
  });

  test('returns null when oauthAccount is missing', () => {
    fs.writeFileSync(testConfigFile, JSON.stringify({ someOtherKey: 'value' }));
    const result = getAccountInfo(testDir);
    expect(result).toBeNull();
  });

  test('returns oauthAccount when present', () => {
    const mockAccount = {
      accountUuid: 'test-uuid',
      emailAddress: 'test@example.com',
      organizationUuid: 'org-uuid',
      displayName: 'Test User',
    };
    fs.writeFileSync(testConfigFile, JSON.stringify({ oauthAccount: mockAccount }));
    const result = getAccountInfo(testDir);
    expect(result).toEqual(mockAccount);
  });

  test('returns null for invalid JSON', () => {
    fs.writeFileSync(testConfigFile, 'not valid json');
    const result = getAccountInfo(testDir);
    expect(result).toBeNull();
  });
});

describe('formatTimeUntilReset (via parseAPIResponse)', () => {
  // We can't directly test formatTimeUntilReset since it's not exported,
  // but we can test it indirectly through the formatted output in parseAPIResponse.
  // For more thorough testing, we could export the function.
  // For now, we'll note this as a limitation.

  test.todo('formatTimeUntilReset returns "Now" for past dates');
  test.todo('formatTimeUntilReset returns "30m" for 30 minutes in future');
  test.todo('formatTimeUntilReset returns "2h 15m" for 2h15m in future');
  test.todo('formatTimeUntilReset returns "1d 2h" for 26 hours in future');
});

describe('parseAPIResponse', () => {
  // parseAPIResponse is also not exported, but we can test it indirectly
  // or note it as a candidate for refactoring to be testable.

  test.todo('correctly parses 5-hour window');
  test.todo('correctly parses 7-day window');
  test.todo('correctly parses extra usage when enabled');
  test.todo('handles missing extra usage');
});

// Note: For comprehensive testing, we should consider:
// 1. Exporting formatTimeUntilReset and parseAPIResponse for direct testing
// 2. Or creating a separate testable module for pure formatting functions
