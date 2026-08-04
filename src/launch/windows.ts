/**
 * Windows launch path.
 *
 * Attaches Claude directly to the terminal via `stdio: 'inherit'` instead of the
 * node-pty wrapper used on macOS/Linux. node-pty's only Windows backend is
 * ConPTY, which owns the viewport and reprints it — breaking Windows Terminal's
 * native scrollback and text selection. With inherit, both work as if you ran
 * `claude` directly.
 *
 * Since hub is then not in Claude's stdin, F9/F10 are detected by polling
 * (see keyPoller.ts) and drive the same /hub and /switch handlers via a Windows
 * CommandContext. Rate-limit auto-switch isn't available here (no output
 * scanning); F10 is the manual switch.
 */

import { spawn } from 'child_process';
import { loadConfig } from '../config';
import { buildAuthEnv } from '../auth';
import { syncConversations, syncHistory } from '../sync';
import { registerSession, unregisterSession, APIUsageData } from '../usage';
import { executeCommand, CommandContext } from '../commands';
import { platform } from '../platform';
import { startFunctionKeyPoller, readOneKey, OneKeyReader } from './keyPoller';
import { findActiveSessionId } from '../utils/session';

export function launchClaudeWindows(
  config: ReturnType<typeof loadConfig>,
  accountName: string,
  claudeArgs: string[],
  usageData: APIUsageData[],
  verbose: boolean
): void {
  const accountPath = config.accounts[accountName];

  if (!accountPath) {
    console.error(`Error: Account '${accountName}' not found in config`);
    console.error(`Available accounts: ${Object.keys(config.accounts).join(', ')}`);
    process.exit(1);
  }

  // Also points BROWSER at this account's Chrome profile, so a /login typed
  // mid-session opens the browser already signed in as this account.
  const env = buildAuthEnv(accountName, accountPath, config);

  registerSession(accountName);
  const cleanupSession = () => unregisterSession();
  process.on('exit', cleanupSession);
  process.on('SIGINT', () => { cleanupSession(); process.exit(0); });
  process.on('SIGTERM', () => { cleanupSession(); process.exit(0); });

  const child = spawn(platform.resolveCommand('claude'), claudeArgs, {
    env,
    stdio: 'inherit',
  });

  // Guards re-entry while an overlay is open / a switch is in progress.
  let overlayBusy = false;
  let isHandlingManualSwitch = false;

  // One-shot key reader backing the overlay handlers' setInputHandler().
  let currentInputHandler: ((data: string) => void) | null = null;
  let pendingReader: OneKeyReader | null = null;

  const pumpKeys = () => {
    if (!currentInputHandler) return;
    pendingReader = readOneKey();
    pendingReader.promise
      .then((key) => {
        pendingReader = null;
        const handler = currentInputHandler;
        if (handler) {
          handler(key);
          // Handler clears itself once satisfied; if still set, it wants more.
          if (currentInputHandler) pumpKeys();
        }
      })
      .catch(() => { pendingReader = null; });
  };

  const keyPoller = startFunctionKeyPoller({
    onF9: () => { void runOverlay('/hub'); },
    onF10: () => { void runOverlay('/switch'); },
  });

  const createCommandContext = (): CommandContext => ({
    accountName,
    accounts: config.accounts,
    usageData,
    // Overlays use the alternate screen buffer (restored by the terminal), so
    // pausing Claude's output / redrawing is unnecessary under inherit.
    pauseOutput: () => {},
    resumeOutput: () => {},
    triggerRedraw: () => {},
    setInputHandler: (handler) => {
      currentInputHandler = handler;
      if (handler) {
        pumpKeys();
      } else if (pendingReader) {
        pendingReader.cancel();
        pendingReader = null;
      }
    },
    switchAccount: (newAccountName: string, resumeSession: boolean) => {
      isHandlingManualSwitch = true;
      keyPoller.stop();

      // Resolve the session ID before sync (sync changes file mtimes).
      const sessionId = resumeSession ? findActiveSessionId(accountPath) : null;

      try { child.kill(); } catch { /* already gone */ }

      console.log('');
      console.log(`⚡ Switching to ${newAccountName}...`);
      console.log('   Syncing conversations...');
      syncConversations(config, false);
      syncHistory(config, false);
      console.log('   ✓ Sync complete');

      let resumeArgs = claudeArgs;
      if (sessionId) {
        const filteredArgs = claudeArgs.filter((a, i) => {
          if (a === '--resume') return false;
          if (i > 0 && claudeArgs[i - 1] === '--resume') return false;
          return true;
        });
        resumeArgs = ['--resume', sessionId, ...filteredArgs];
        console.log(`   Resuming session: ${sessionId.slice(0, 8)}...`);
      }

      console.log(`   Launching with ${newAccountName}`);
      console.log('');

      launchClaudeWindows(config, newAccountName, resumeArgs, usageData, verbose);
    },
  });

  // Run an F9/F10 overlay, guarding against re-entry.
  async function runOverlay(command: '/hub' | '/switch'): Promise<void> {
    if (overlayBusy) return;
    overlayBusy = true;
    try {
      const context = createCommandContext();
      const result = await executeCommand(command, context);
      if (result.message) console.log(result.message);
    } catch (err) {
      process.stderr.write(`Hub ${command} error: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      currentInputHandler = null;
      if (pendingReader) { pendingReader.cancel(); pendingReader = null; }
      overlayBusy = false;
    }
  }

  child.on('error', (error) => {
    keyPoller.stop();
    console.error('Error launching Claude:', error.message);
    console.error('Make sure "claude" is installed and available in your PATH');
    process.exit(1);
  });

  child.on('exit', (code) => {
    keyPoller.stop();
    if (pendingReader) { pendingReader.cancel(); pendingReader = null; }
    if (isHandlingManualSwitch) return; // intentional kill for a switch
    process.exit(code || 0);
  });
}
