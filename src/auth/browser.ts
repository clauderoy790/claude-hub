/**
 * Browser Profile Routing
 *
 * Each Claude account gets its own Chrome profile, named after the account, so
 * signing in never means logging claude.ai out of another account first.
 * Account "cc2" uses Chrome profile "cc2" — no configuration, no ambiguity.
 *
 * Claude Code opens the browser by spawning `$BROWSER <url>`. We write a tiny
 * wrapper script that opens Chrome with `--profile-directory=<account>` and
 * point BROWSER at it — which routes both `hub login` and any `/login` typed
 * mid-session to the right profile.
 *
 * Chrome creates a profile directory on first use, so a new account needs no
 * setup: its profile appears the first time it signs in.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { platform } from '../platform';
import { Config } from '../config';

/** Where hub keeps generated wrapper scripts */
const BROWSER_DIR = path.join(os.homedir(), '.claude-hub', 'browser');

/**
 * The Chrome profile an account should use.
 *
 * Defaults to the account name. `chromeProfiles` in config.json overrides it,
 * for pointing an account at a profile you already have.
 */
export function resolveProfileDirectory(accountName: string, config: Config): string {
  return config.chromeProfiles?.[accountName] ?? accountName;
}

/**
 * Whether Chrome is installed and usable on this machine.
 *
 * Without it we leave BROWSER alone and Claude Code falls back to the system
 * default browser — the old behaviour, with the old account-switching dance.
 */
export function isChromeAvailable(): boolean {
  try {
    return fs.existsSync(platform.chromeUserDataDir());
  } catch {
    return false;
  }
}

/**
 * Write (or refresh) the wrapper script for an account and return its path.
 */
export function ensureBrowserWrapper(accountName: string, profileDirectory: string): string {
  const script = platform.browserProfileScript(profileDirectory);
  const dir = path.join(BROWSER_DIR, accountName);

  fs.mkdirSync(dir, { recursive: true });

  const scriptPath = path.join(dir, script.fileName);
  fs.writeFileSync(scriptPath, script.contents, { mode: script.mode });
  // writeFileSync only applies mode when creating, so set it explicitly
  fs.chmodSync(scriptPath, script.mode);

  return scriptPath;
}

/**
 * Build the environment for launching `claude` (or `claude auth login`) for an
 * account, routing its browser to that account's Chrome profile.
 */
export function buildAuthEnv(
  accountName: string,
  configDir: string,
  config: Config,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  // ~/.claude reads its config from the default location; setting
  // CLAUDE_CONFIG_DIR for it would point Claude at ~/.claude/.claude.json
  if (configDir !== path.join(os.homedir(), '.claude')) {
    env.CLAUDE_CONFIG_DIR = configDir;
  }

  if (isChromeAvailable()) {
    try {
      env.BROWSER = ensureBrowserWrapper(accountName, resolveProfileDirectory(accountName, config));
    } catch {
      // A missing wrapper just means the default browser opens instead —
      // not worth failing a login over.
    }
  }

  return env;
}
