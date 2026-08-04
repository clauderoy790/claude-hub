/**
 * Unit tests for src/platform/
 *
 * Tests the platform abstraction layer that handles cross-platform differences.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { LoggedOutError } from '../../src/platform/types';

describe('Platform abstraction', () => {
  describe('platform selection', () => {
    test('exports a platform object', () => {
      // Dynamic import to test the actual exported platform
      const { platform } = require('../../src/platform');
      expect(platform).toBeDefined();
      expect(platform.name).toBeDefined();
      expect(['macos', 'windows']).toContain(platform.name);
    });

    test('platform has required methods', () => {
      const { platform } = require('../../src/platform');
      expect(typeof platform.getCredentials).toBe('function');
      expect(typeof platform.resolveCommand).toBe('function');
    });

    test('platform.name matches current OS', () => {
      const { platform } = require('../../src/platform');
      if (process.platform === 'darwin') {
        expect(platform.name).toBe('macos');
      } else if (process.platform === 'win32') {
        expect(platform.name).toBe('windows');
      }
    });
  });

  describe('macPlatform', () => {
    const { macPlatform } = require('../../src/platform/mac');

    test('has name "macos"', () => {
      expect(macPlatform.name).toBe('macos');
    });

    test('has getCredentials method', () => {
      expect(typeof macPlatform.getCredentials).toBe('function');
    });

    test('has resolveCommand method', () => {
      expect(typeof macPlatform.resolveCommand).toBe('function');
    });
  });

  describe('windowsPlatform', () => {
    const { windowsPlatform } = require('../../src/platform/windows');

    test('has name "windows"', () => {
      expect(windowsPlatform.name).toBe('windows');
    });

    test('has getCredentials method', () => {
      expect(typeof windowsPlatform.getCredentials).toBe('function');
    });

    test('has resolveCommand method', () => {
      expect(typeof windowsPlatform.resolveCommand).toBe('function');
    });
  });

  describe('CredentialData type', () => {
    test('platform exports CredentialData type', () => {
      // This is a compile-time check - if it compiles, the type is exported
      const { platform } = require('../../src/platform');
      // We can't directly test types at runtime, but we can verify the structure
      // when we get actual credentials
    });
  });
});

describe('Windows platform credentials', () => {
  const { windowsPlatform } = require('../../src/platform/windows');
  const testDir = path.join(os.tmpdir(), 'claude-hub-win-test-' + Date.now());
  const credentialsFile = path.join(testDir, '.credentials.json');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (fs.existsSync(credentialsFile)) {
      fs.unlinkSync(credentialsFile);
    }
  });

  test('throws when credentials file does not exist', () => {
    expect(() => {
      windowsPlatform.getCredentials('/nonexistent/path');
    }).toThrow(/Not logged in/);
  });

  test('reads valid credentials file', () => {
    const mockCredentials = {
      claudeAiOauth: {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['scope1'],
        subscriptionType: 'pro',
        rateLimitTier: 'tier1',
      },
    };
    fs.writeFileSync(credentialsFile, JSON.stringify(mockCredentials));

    const result = windowsPlatform.getCredentials(testDir);
    expect(result.claudeAiOauth.accessToken).toBe('test-access-token');
    expect(result.claudeAiOauth.refreshToken).toBe('test-refresh-token');
  });

  test('throws for invalid JSON', () => {
    fs.writeFileSync(credentialsFile, 'not valid json');
    expect(() => {
      windowsPlatform.getCredentials(testDir);
    }).toThrow(/Failed to read credentials/);
  });

  test('throws when accessToken is missing', () => {
    const invalidCredentials = {
      claudeAiOauth: {
        refreshToken: 'test-refresh-token',
        // accessToken missing
      },
    };
    fs.writeFileSync(credentialsFile, JSON.stringify(invalidCredentials));
    expect(() => {
      windowsPlatform.getCredentials(testDir);
    }).toThrow(/OAuth token not found/);
  });

  test('reports logged out when Claude Code blanked the credential', () => {
    // Claude Code empties these fields in place after a refresh is rejected,
    // which is a logout rather than a corrupt file
    const blankedCredentials = {
      claudeAiOauth: {
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
        scopes: ['user:inference'],
        subscriptionType: 'pro',
        rateLimitTier: 'default',
      },
    };
    fs.writeFileSync(credentialsFile, JSON.stringify(blankedCredentials));

    expect(() => {
      windowsPlatform.getCredentials(testDir);
    }).toThrow(LoggedOutError);
    expect(() => {
      windowsPlatform.getCredentials(testDir);
    }).toThrow(/hub login/);
  });

  test('preserves refreshTokenExpiresAt when present', () => {
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(credentialsFile, JSON.stringify({
      claudeAiOauth: {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        refreshTokenExpiresAt: expiresAt,
        scopes: ['user:inference'],
        subscriptionType: 'pro',
        rateLimitTier: 'default',
      },
    }));

    const result = windowsPlatform.getCredentials(testDir);
    expect(result.claudeAiOauth.refreshTokenExpiresAt).toBe(expiresAt);
  });
});

describe('Mac platform keychain service name', () => {
  const { getKeychainServiceName } = require('../../src/platform/mac');
  const homeDir = os.homedir();

  test('returns base name for default ~/.claude', () => {
    const result = getKeychainServiceName('~/.claude');
    expect(result).toBe('Claude Code-credentials');
  });

  test('returns hashed name for non-default directory', () => {
    const result = getKeychainServiceName('~/.claude2');
    expect(result).toMatch(/^Claude Code-credentials-[a-f0-9]{8}$/);
  });

  test('expanded and tilde paths produce same hash', () => {
    const tildeResult = getKeychainServiceName('~/.claude-test');
    const expandedResult = getKeychainServiceName(path.join(homeDir, '.claude-test'));
    expect(tildeResult).toBe(expandedResult);
  });
});
