/**
 * Unit tests for src/setup/addAccount.ts
 *
 * Tests account name validation and config directory generation.
 * These are pure functions that should work identically on all platforms.
 */

import { validateAccountName, getAccountConfigDir } from '../../src/setup/addAccount';

describe('validateAccountName', () => {
  describe('valid names', () => {
    test('accepts simple alphanumeric name', () => {
      const result = validateAccountName('work');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('accepts name with numbers', () => {
      const result = validateAccountName('account2');
      expect(result.valid).toBe(true);
    });

    test('accepts name with dash', () => {
      const result = validateAccountName('my-account');
      expect(result.valid).toBe(true);
    });

    test('accepts name with underscore', () => {
      const result = validateAccountName('my_account');
      expect(result.valid).toBe(true);
    });

    test('accepts name with mixed case', () => {
      const result = validateAccountName('MyAccount');
      expect(result.valid).toBe(true);
    });

    test('accepts single character', () => {
      const result = validateAccountName('a');
      expect(result.valid).toBe(true);
    });

    test('accepts name at max length (50 chars)', () => {
      const name = 'a'.repeat(50);
      const result = validateAccountName(name);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid names', () => {
    test('rejects empty string', () => {
      const result = validateAccountName('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Account name is required');
    });

    test('rejects name with spaces', () => {
      const result = validateAccountName('my account');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('letters, numbers, dashes, and underscores');
    });

    test('rejects name with @ symbol', () => {
      const result = validateAccountName('user@work');
      expect(result.valid).toBe(false);
    });

    test('rejects name with dot', () => {
      const result = validateAccountName('my.account');
      expect(result.valid).toBe(false);
    });

    test('rejects name with slash', () => {
      const result = validateAccountName('my/account');
      expect(result.valid).toBe(false);
    });

    test('rejects name over max length', () => {
      const name = 'a'.repeat(51);
      const result = validateAccountName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    test('rejects name with emoji', () => {
      const result = validateAccountName('work🚀');
      expect(result.valid).toBe(false);
    });
  });
});

describe('getAccountConfigDir', () => {
  test('returns ~/.claude for "main" (special case)', () => {
    const result = getAccountConfigDir('main');
    expect(result).toBe('~/.claude');
  });

  test('returns ~/.claude-<name> for other names', () => {
    const result = getAccountConfigDir('work');
    expect(result).toBe('~/.claude-work');
  });

  test('handles numeric suffix', () => {
    const result = getAccountConfigDir('account2');
    expect(result).toBe('~/.claude-account2');
  });

  test('handles name with dash', () => {
    const result = getAccountConfigDir('my-work');
    expect(result).toBe('~/.claude-my-work');
  });

  test('handles name with underscore', () => {
    const result = getAccountConfigDir('my_work');
    expect(result).toBe('~/.claude-my_work');
  });
});
