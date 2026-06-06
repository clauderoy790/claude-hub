/**
 * Unit tests for src/setup/renameAccount.ts
 *
 * Tests account renaming with various edge cases:
 * - Valid renames
 * - Non-existent source account
 * - Target name already exists
 * - Invalid target name format
 * - Same old and new name
 */

import { renameAccount } from '../../src/setup/renameAccount';
import { Config } from '../../src/config';

// Mock saveConfig to prevent actual file writes
jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  saveConfig: jest.fn(),
}));

describe('renameAccount', () => {
  const createTestConfig = (): Config => ({
    accounts: {
      main: '~/.claude',
      work: '~/.claude-work',
      personal: '~/.claude-personal',
    },
    masterFolder: '~/.claude-hub-master',
    syncOnStart: true,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('successful renames', () => {
    test('renames account successfully', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'cc1', config);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(config.accounts['cc1']).toBe('~/.claude');
      expect(config.accounts['main']).toBeUndefined();
    });

    test('preserves the config directory path', () => {
      const config = createTestConfig();
      const originalPath = config.accounts['work'];

      renameAccount('work', 'office', config);

      expect(config.accounts['office']).toBe(originalPath);
    });

    test('preserves other accounts unchanged', () => {
      const config = createTestConfig();

      renameAccount('main', 'primary', config);

      expect(config.accounts['work']).toBe('~/.claude-work');
      expect(config.accounts['personal']).toBe('~/.claude-personal');
    });

    test('allows renaming to name with numbers', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'cc1', config);

      expect(result.success).toBe(true);
    });

    test('allows renaming to name with dashes', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'my-account', config);

      expect(result.success).toBe(true);
    });

    test('allows renaming to name with underscores', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'my_account', config);

      expect(result.success).toBe(true);
    });
  });

  describe('non-existent source account', () => {
    test('fails when old account does not exist', () => {
      const config = createTestConfig();
      const result = renameAccount('nonexistent', 'newname', config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    test('lists available accounts in error message', () => {
      const config = createTestConfig();
      const result = renameAccount('nonexistent', 'newname', config);

      expect(result.error).toContain('main');
      expect(result.error).toContain('work');
      expect(result.error).toContain('personal');
    });
  });

  describe('target name already exists', () => {
    test('fails when new name already exists', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'work', config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    test('does not modify config when name exists', () => {
      const config = createTestConfig();
      const originalMain = config.accounts['main'];
      const originalWork = config.accounts['work'];

      renameAccount('main', 'work', config);

      expect(config.accounts['main']).toBe(originalMain);
      expect(config.accounts['work']).toBe(originalWork);
    });
  });

  describe('invalid new name format', () => {
    test('fails for empty new name', () => {
      const config = createTestConfig();
      const result = renameAccount('main', '', config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    test('fails for name with spaces', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'my account', config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('letters, numbers, dashes, and underscores');
    });

    test('fails for name with special characters', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'user@work', config);

      expect(result.success).toBe(false);
    });

    test('fails for name with dots', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'my.account', config);

      expect(result.success).toBe(false);
    });

    test('fails for name with slashes', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'my/account', config);

      expect(result.success).toBe(false);
    });

    test('fails for name over 50 characters', () => {
      const config = createTestConfig();
      const longName = 'a'.repeat(51);
      const result = renameAccount('main', longName, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('too long');
    });

    test('fails for name with emoji', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'work🚀', config);

      expect(result.success).toBe(false);
    });

    test('fails for name with unicode', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'wörk', config);

      expect(result.success).toBe(false);
    });
  });

  describe('same name rename', () => {
    test('fails when old and new names are the same', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'main', config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('same');
    });
  });

  describe('case sensitivity', () => {
    test('treats names as case-sensitive', () => {
      const config = createTestConfig();
      const result = renameAccount('main', 'Main', config);

      // Should succeed since 'Main' is different from 'main'
      expect(result.success).toBe(true);
      expect(config.accounts['Main']).toBe('~/.claude');
    });
  });
});
