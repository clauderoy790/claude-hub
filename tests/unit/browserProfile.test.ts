/**
 * Unit tests for src/auth/browser.ts and the platform browser-script builders
 *
 * The wrapper script is what routes each account's login to its own Chrome
 * profile, so its shape (and quoting) matters.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { macPlatform } from '../../src/platform/mac';
import { windowsPlatform } from '../../src/platform/windows';
import { Config } from '../../src/config';

const chromeDirRef = { value: path.join(os.tmpdir(), 'claude-hub-chrome-test-' + Date.now()) };

// Point the browser module at a fake Chrome user-data directory
jest.mock('../../src/platform', () => ({
  platform: {
    name: 'macos',
    chromeUserDataDir: () => chromeDirRef.value,
    browserProfileScript: (profile: string) =>
      jest.requireActual('../../src/platform/mac').macPlatform.browserProfileScript(profile),
  },
}));

import {
  resolveProfileDirectory,
  isChromeAvailable,
  ensureBrowserWrapper,
  buildAuthEnv,
} from '../../src/auth/browser';

const baseConfig: Config = {
  accounts: { cc1: '/home/me/.claude-cc1', cc2: '/home/me/.claude-cc2' },
  masterFolder: '/home/me/master',
  syncOnStart: true,
};

afterAll(() => {
  fs.rmSync(chromeDirRef.value, { recursive: true, force: true });
  fs.rmSync(path.join(os.homedir(), '.claude-hub', 'browser', '__test-account'), {
    recursive: true,
    force: true,
  });
});

describe('resolveProfileDirectory', () => {
  test('defaults to the account name so profiles are self-describing', () => {
    expect(resolveProfileDirectory('cc2', baseConfig)).toBe('cc2');
  });

  test('config override wins, for pointing at a pre-existing profile', () => {
    const config: Config = { ...baseConfig, chromeProfiles: { cc2: 'Profile 2' } };
    expect(resolveProfileDirectory('cc2', config)).toBe('Profile 2');
  });

  test('override for one account does not affect others', () => {
    const config: Config = { ...baseConfig, chromeProfiles: { cc2: 'Profile 2' } };
    expect(resolveProfileDirectory('cc1', config)).toBe('cc1');
  });
});

describe('isChromeAvailable', () => {
  test('true when Chrome user data directory exists', () => {
    fs.mkdirSync(chromeDirRef.value, { recursive: true });
    expect(isChromeAvailable()).toBe(true);
  });

  test('false when Chrome is not installed', () => {
    const realDir = chromeDirRef.value;
    chromeDirRef.value = path.join(os.tmpdir(), 'claude-hub-no-chrome-here');
    expect(isChromeAvailable()).toBe(false);
    chromeDirRef.value = realDir;
  });
});

describe('ensureBrowserWrapper', () => {
  test('writes an executable script for the account', () => {
    const scriptPath = ensureBrowserWrapper('__test-account', 'cc2');

    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.statSync(scriptPath).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(scriptPath, 'utf-8')).toContain(`--profile-directory='cc2'`);
  });
});

describe('buildAuthEnv', () => {
  beforeEach(() => {
    fs.mkdirSync(chromeDirRef.value, { recursive: true });
  });

  test('sets CLAUDE_CONFIG_DIR and BROWSER for a named account', () => {
    const env = buildAuthEnv('cc2', '/home/me/.claude-cc2', baseConfig, {});

    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude-cc2');
    expect(env.BROWSER).toContain(path.join('.claude-hub', 'browser', 'cc2'));
  });

  test('omits CLAUDE_CONFIG_DIR for the default ~/.claude directory', () => {
    const defaultDir = path.join(os.homedir(), '.claude');
    const env = buildAuthEnv('main', defaultDir, baseConfig, {});

    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  test('leaves BROWSER alone when Chrome is not installed', () => {
    const realDir = chromeDirRef.value;
    chromeDirRef.value = path.join(os.tmpdir(), 'claude-hub-no-chrome-here');

    const env = buildAuthEnv('cc2', '/home/me/.claude-cc2', baseConfig, {});
    expect(env.BROWSER).toBeUndefined();

    chromeDirRef.value = realDir;
  });

  test('does not mutate the base environment', () => {
    const base = { PATH: '/usr/bin' };
    buildAuthEnv('cc2', '/home/me/.claude-cc2', baseConfig, base);

    expect(base).toEqual({ PATH: '/usr/bin' });
  });
});

describe('closeLoginTabs script', () => {
  const { buildCloseLoginTabsScript } = jest.requireActual('../../src/platform/mac');
  const script: string = buildCloseLoginTabsScript();

  test('iterates windows and tabs back-to-front', () => {
    // Forward iteration skips items: closing a tab shifts the indexes after it,
    // and closing a window's last tab removes the window mid-loop.
    expect(script).toContain('set wi to (count of windows)');
    expect(script).toContain('repeat while wi > 0');
    expect(script).toContain('set wi to wi - 1');
    expect(script).toContain('set i to (count of tabs of window wi)');
    expect(script).toContain('set i to i - 1');
    expect(script).not.toContain('repeat with w in (every window)');
  });

  test('matches only OAuth flow URLs, never ordinary Claude tabs', () => {
    expect(script).toContain('"/oauth/code/success"');
    expect(script).toContain('"/oauth/authorize"');
    expect(script).toContain('"claude.ai/login"');

    // A chat URL must not contain any of the patterns
    const patterns = ['/oauth/code/success', '/cai/oauth/authorize', '/oauth/authorize', 'claude.ai/login'];
    const ordinaryTab = 'https://claude.ai/chat/8f1c-4b2a';
    expect(patterns.some(p => ordinaryTab.includes(p))).toBe(false);

    const successTab = 'https://platform.claude.com/oauth/code/success?app=claude-code';
    expect(patterns.some(p => successTab.includes(p))).toBe(true);
  });

  test('bails out when Chrome is not running', () => {
    expect(script).toContain('if it is not running then return');
  });

  test('quits Chrome only when no windows survive the cleanup', () => {
    // Guards a user who actually browses in Chrome: their windows remain, so the
    // count is non-zero and the browser is left alone.
    expect(script).toContain('if (count of windows) is 0 then quit');
    expect(script).not.toMatch(/^\s*quit\s*$/m);
  });
});

describe('browserProfileScript', () => {
  test('macOS script opens Chrome with the requested profile', () => {
    const script = macPlatform.browserProfileScript('cc2');

    expect(script.fileName).toBe('open-profile.sh');
    expect(script.contents).toContain('#!/bin/sh');
    expect(script.contents).toContain(`--profile-directory='cc2'`);
    expect(script.contents).toContain('"$1"');
    expect(script.mode).toBe(0o755);
  });

  test('macOS script escapes quotes in the profile name', () => {
    const script = macPlatform.browserProfileScript("Bob's Profile");
    expect(script.contents).toContain(`'Bob'\\''s Profile'`);
  });

  test('Windows script uses start so Chrome need not be on PATH', () => {
    const script = windowsPlatform.browserProfileScript('cc2');

    expect(script.fileName).toBe('open-profile.cmd');
    expect(script.contents).toContain('start "" chrome.exe');
    expect(script.contents).toContain('--profile-directory="cc2"');
    expect(script.contents).toContain('%1');
  });
});
