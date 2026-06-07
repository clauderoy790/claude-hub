/**
 * Windows key detection without a PTY, native deps, or a global hook.
 *
 * Under the inherit-based Windows launch, hub isn't in Claude's stdin, so F9/F10
 * are detected by polling `GetAsyncKeyState` from a small inline PowerShell
 * process — a benign API (not a keyboard hook, so antivirus doesn't flag it). A
 * focus filter (foreground window captured at launch) means keys only fire when
 * this terminal is focused.
 *
 * - startFunctionKeyPoller: long-lived, emits 'F9'/'F10'.
 * - readOneKey: short-lived, resolves with the first key for an open overlay.
 */

import { spawn, ChildProcess } from 'child_process';

const PS_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'];

/** Shared P/Invoke + helpers injected into each inline script. */
const PS_PREAMBLE = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class U32 {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$ourWindow = [U32]::GetForegroundWindow()
function Down([int]$vk) { return ([int][U32]::GetAsyncKeyState($vk) -band 0x8000) -ne 0 }
function Focused() { return ([U32]::GetForegroundWindow() -eq $ourWindow) }
`;

export interface FunctionKeyPoller {
  /** Stop the poller and kill the PowerShell process. */
  stop(): void;
}

/**
 * Start polling for F9/F10 while Claude runs. Callbacks fire only when this
 * terminal is the foreground window.
 */
export function startFunctionKeyPoller(handlers: {
  onF9: () => void;
  onF10: () => void;
}): FunctionKeyPoller {
  // VK_F9 = 0x78, VK_F10 = 0x79. Emit a line on the rising edge, focused only.
  const script = `${PS_PREAMBLE}
$prev = @{ 0x78 = $false; 0x79 = $false }
while ($true) {
  $f = Focused
  foreach ($vk in 0x78, 0x79) {
    $d = Down $vk
    if ($d -and -not $prev[$vk] -and $f) {
      if ($vk -eq 0x78) { [Console]::Out.WriteLine('F9') }
      else { [Console]::Out.WriteLine('F10') }
      [Console]::Out.Flush()
    }
    $prev[$vk] = $d
  }
  Start-Sleep -Milliseconds 40
}
`;

  const child = spawn('powershell', [...PS_ARGS, script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });

  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === 'F9') handlers.onF9();
      else if (line === 'F10') handlers.onF10();
    }
  });

  // If the poller dies unexpectedly, F9/F10 just stop working — don't crash hub.
  child.on('error', () => {});

  return {
    stop() {
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}

export interface OneKeyReader {
  /** Resolves with a single key string ('1'..'9', '\x1b' for Esc, '\r', a letter, ' '). */
  promise: Promise<string>;
  /** Cancel the read (kills the PowerShell process); promise rejects. */
  cancel(): void;
}

/**
 * Read a single keypress (focused only) for an open overlay/menu. Polls digits,
 * letters, space, Enter and Esc; resolves with the first one pressed.
 */
export function readOneKey(): OneKeyReader {
  // Emit a token for the first focused rising-edge key, then exit.
  const script = `${PS_PREAMBLE}
# Prime previous-state so a key already held when we start doesn't count.
$watch = @(0x1B, 0x0D, 0x20) + (0x30..0x39) + (0x41..0x5A)
$prev = @{}
foreach ($vk in $watch) { $prev[$vk] = Down $vk }
while ($true) {
  $f = Focused
  foreach ($vk in $watch) {
    $d = Down $vk
    if ($d -and -not $prev[$vk] -and $f) {
      switch ($vk) {
        0x1B { [Console]::Out.WriteLine('ESC') }
        0x0D { [Console]::Out.WriteLine('ENTER') }
        0x20 { [Console]::Out.WriteLine('SPACE') }
        default {
          if ($vk -ge 0x30 -and $vk -le 0x39) { [Console]::Out.WriteLine([string][char]$vk) }
          else { [Console]::Out.WriteLine(([string][char]$vk).ToLower()) }
        }
      }
      [Console]::Out.Flush()
      exit 0
    }
    $prev[$vk] = $d
  }
  Start-Sleep -Milliseconds 30
}
`;

  const child: ChildProcess = spawn('powershell', [...PS_ARGS, script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });

  let settled = false;
  let buffer = '';

  const promise = new Promise<string>((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const token = buffer.slice(0, nl).trim();
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already exiting */ }

      if (token === 'ESC') resolve('\x1b');
      else if (token === 'ENTER') resolve('\r');
      else if (token === 'SPACE') resolve(' ');
      else resolve(token);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    child.on('exit', () => {
      if (settled) return;
      settled = true;
      reject(new Error('key reader exited without a key'));
    });
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
    },
  };
}
