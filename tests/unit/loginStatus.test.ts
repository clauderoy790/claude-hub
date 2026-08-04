/**
 * Unit tests for src/auth/status.ts
 *
 * Covers how a stored credential maps to a login state: healthy, close to
 * expiry, past expiry, or blanked out by a failed refresh.
 */

import { LoggedOutError } from '../../src/platform/types';

// Mock the platform singleton so tests never touch the real keychain
const mockGetCredentials = jest.fn();
jest.mock('../../src/platform', () => ({
  platform: {
    name: 'macos',
    getCredentials: (configDir: string) => mockGetCredentials(configDir),
  },
  LoggedOutError: jest.requireActual('../../src/platform/types').LoggedOutError,
}));

// Account email lookup reads .claude.json; not under test here
jest.mock('../../src/usage/api', () => ({
  getAccountInfo: () => ({ emailAddress: 'user@example.com' }),
}));

import {
  getLoginStatus,
  describeLoginStatus,
  needsLogin,
  WARN_DAYS,
} from '../../src/auth/status';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Build a credential whose login window ends `days` from now */
function credentialExpiringIn(days: number | undefined) {
  return {
    claudeAiOauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      ...(days === undefined ? {} : { refreshTokenExpiresAt: Date.now() + days * MS_PER_DAY }),
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      rateLimitTier: 'default',
    },
  };
}

beforeEach(() => {
  mockGetCredentials.mockReset();
});

describe('getLoginStatus', () => {
  test('healthy login well before expiry is ok', () => {
    mockGetCredentials.mockReturnValue(credentialExpiringIn(20));

    const status = getLoginStatus('cc1', '~/.claude-cc1');

    expect(status.state).toBe('ok');
    expect(status.daysLeft).toBe(20);
    expect(status.emailAddress).toBe('user@example.com');
  });

  test('login inside the warning window is expiring', () => {
    mockGetCredentials.mockReturnValue(credentialExpiringIn(WARN_DAYS - 1));

    const status = getLoginStatus('cc1', '~/.claude-cc1');

    expect(status.state).toBe('expiring');
    expect(status.daysLeft).toBe(WARN_DAYS - 1);
  });

  test('login past its window is expired', () => {
    mockGetCredentials.mockReturnValue(credentialExpiringIn(-2));

    const status = getLoginStatus('cc1', '~/.claude-cc1');

    expect(status.state).toBe('expired');
    expect(needsLogin(status.state)).toBe(true);
  });

  test('blanked credential is logged-out', () => {
    mockGetCredentials.mockImplementation(() => {
      throw new LoggedOutError('~/.claude-cc2');
    });

    const status = getLoginStatus('cc2', '~/.claude-cc2');

    expect(status.state).toBe('logged-out');
    expect(needsLogin(status.state)).toBe(true);
  });

  test('never-logged-in account is logged-out', () => {
    mockGetCredentials.mockImplementation(() => {
      throw new Error('Not logged in for ~/.claude-cc3. Run `claude` with that config.');
    });

    expect(getLoginStatus('cc3', '~/.claude-cc3').state).toBe('logged-out');
  });

  test('credential without refreshTokenExpiresAt is ok, not a false warning', () => {
    mockGetCredentials.mockReturnValue(credentialExpiringIn(undefined));

    const status = getLoginStatus('cc4', '~/.claude-cc4');

    expect(status.state).toBe('ok');
    expect(status.daysLeft).toBeUndefined();
  });

  test('unreadable credential is unknown, not logged-out', () => {
    mockGetCredentials.mockImplementation(() => {
      throw new Error('Failed to read keychain for ~/.claude-cc1: user denied access');
    });

    const status = getLoginStatus('cc1', '~/.claude-cc1');

    expect(status.state).toBe('unknown');
    expect(needsLogin(status.state)).toBe(false);
    expect(status.error).toMatch(/user denied access/);
  });
});

describe('describeLoginStatus', () => {
  test('says nothing for a healthy login', () => {
    mockGetCredentials.mockReturnValue(credentialExpiringIn(20));
    expect(describeLoginStatus(getLoginStatus('cc1', '~/.claude-cc1'))).toBeNull();
  });

  test('pluralises days correctly', () => {
    mockGetCredentials.mockReturnValue(credentialExpiringIn(1));
    expect(describeLoginStatus(getLoginStatus('cc1', '~/.claude-cc1'))).toBe('login expires in 1 day');

    mockGetCredentials.mockReturnValue(credentialExpiringIn(3));
    expect(describeLoginStatus(getLoginStatus('cc1', '~/.claude-cc1'))).toBe('login expires in 3 days');
  });

  test('describes signed-out accounts', () => {
    mockGetCredentials.mockImplementation(() => {
      throw new LoggedOutError('~/.claude-cc2');
    });
    expect(describeLoginStatus(getLoginStatus('cc2', '~/.claude-cc2'))).toBe('logged out');
  });
});
