/**
 * PTY Wrapper - Wraps Claude in a pseudo-terminal for output monitoring
 *
 * Provides:
 * - Full terminal emulation (colors, cursor, etc.)
 * - Real-time output monitoring for rate limit detection
 * - Input command interception (/hub, /switch)
 * - Terminal resize handling
 * - Graceful process management
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';

const RATE_LIMIT_TRIGGER = "You've hit your limit";

// Function key escape sequences (xterm style)
const F9_SEQ = '\x1b[20~';
const F10_SEQ = '\x1b[21~';

/**
 * Resolve the full path to a command using 'which'
 * node-pty doesn't do PATH resolution like a shell does
 */
function resolveCommand(command: string): string {
  try {
    const fullPath = execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
    return fullPath || command;
  } catch {
    return command;
  }
}

export interface PtyWrapperOptions {
  /** Command to run (default: 'claude') */
  command?: string;
  /** Arguments to pass to command */
  args?: string[];
  /** Environment variables */
  env?: NodeJS.ProcessEnv;
  /** Working directory */
  cwd?: string;
  /** Callback when rate limit is detected */
  onRateLimitDetected?: () => void;
  /** Callback when process exits */
  onExit?: (code: number) => void;
  /** Callback when F9 is pressed (show usage) */
  onF9?: () => Promise<void>;
  /** Callback when F10 is pressed (switch account) */
  onF10?: () => Promise<void>;
}

/** Input handler type for commands */
export type CommandInputHandler = (data: string) => void;

export interface PtyWrapper extends EventEmitter {
  /** Write data to the PTY (user input) */
  write(data: string): void;
  /** Resize the PTY */
  resize(cols: number, rows: number): void;
  /** Kill the PTY process */
  kill(signal?: string): void;
  /** Get the underlying PTY process */
  getPty(): pty.IPty | null;
  /** Pause output (don't write to stdout) */
  pauseOutput(): void;
  /** Resume output (write to stdout again) */
  resumeOutput(): void;
  /** Set handler to receive input during command processing */
  setCommandInputHandler(handler: CommandInputHandler | null): void;
  /** Trigger a redraw by sending current terminal size to PTY */
  triggerRedraw(): void;
}

/**
 * Create a PTY wrapper that monitors Claude output for rate limits
 *
 * Events:
 * - 'data': Emitted when output is received (already written to stdout)
 * - 'rate-limit': Emitted when rate limit is detected
 * - 'exit': Emitted when process exits with exit code
 *
 * @param options - Configuration options
 * @returns PTY wrapper instance
 */
export function createPtyWrapper(options: PtyWrapperOptions = {}): PtyWrapper {
  const emitter = new EventEmitter() as PtyWrapper;
  let ptyProcess: pty.IPty | null = null;
  let outputBuffer = '';
  let rateLimitDetected = false;

  // State for function key handling
  let isProcessingFunctionKey = false;
  let outputPaused = false;
  let commandInputHandler: CommandInputHandler | null = null;
  let inputBuffer = ''; // Buffer for detecting escape sequences

  const command = options.command ?? 'claude';
  const args = options.args ?? [];
  const rawEnv = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  // Filter out undefined values from env (node-pty requires string values)
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Resolve full path to command (node-pty doesn't do PATH resolution)
  const resolvedCommand = resolveCommand(command);

  // Get terminal size
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  try {
    ptyProcess = pty.spawn(resolvedCommand, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err) {
    // PTY spawn failed - emit error and return
    process.nextTick(() => {
      emitter.emit('error', err);
    });

    emitter.write = () => {};
    emitter.resize = () => {};
    emitter.kill = () => {};
    emitter.getPty = () => null;
    emitter.pauseOutput = () => {};
    emitter.resumeOutput = () => {};
    emitter.setCommandInputHandler = () => {};
    emitter.triggerRedraw = () => {};

    return emitter;
  }

  // Handle output from Claude
  ptyProcess.onData((data: string) => {
    // Write to stdout unless paused (for command handling)
    if (!outputPaused) {
      process.stdout.write(data);
    }

    // Buffer for rate limit detection (keep last 500 chars)
    outputBuffer += data;
    if (outputBuffer.length > 500) {
      outputBuffer = outputBuffer.slice(-500);
    }

    // Check for rate limit message
    if (!rateLimitDetected && outputBuffer.includes(RATE_LIMIT_TRIGGER)) {
      rateLimitDetected = true;
      emitter.emit('rate-limit');
      if (options.onRateLimitDetected) {
        options.onRateLimitDetected();
      }
    }

    emitter.emit('data', data);
  });

  // Handle process exit
  ptyProcess.onExit(({ exitCode }) => {
    ptyProcess = null;
    emitter.emit('exit', exitCode);
    if (options.onExit) {
      options.onExit(exitCode);
    }
  });

  // Handle terminal resize
  const handleResize = () => {
    if (ptyProcess && process.stdout.columns && process.stdout.rows) {
      ptyProcess.resize(process.stdout.columns, process.stdout.rows);
    }
  };
  process.stdout.on('resize', handleResize);

  // Forward stdin to PTY with function key interception
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const stdinHandler = async (data: Buffer) => {
    const str = data.toString();

    // If we're processing a function key command, forward input to command handler
    if (isProcessingFunctionKey) {
      if (commandInputHandler) {
        commandInputHandler(str);
      }
      return;
    }

    // Buffer input to detect escape sequences
    inputBuffer += str;

    // Check for function key sequences
    if (inputBuffer.includes(F9_SEQ) && options.onF9) {
      // Remove the F9 sequence from buffer
      inputBuffer = inputBuffer.replace(F9_SEQ, '');

      // Forward any remaining buffered input to PTY first
      if (inputBuffer.length > 0 && ptyProcess) {
        ptyProcess.write(inputBuffer);
        inputBuffer = '';
      }

      // Handle F9
      isProcessingFunctionKey = true;
      try {
        await options.onF9();
      } finally {
        isProcessingFunctionKey = false;
      }
      return;
    }

    if (inputBuffer.includes(F10_SEQ) && options.onF10) {
      // Remove the F10 sequence from buffer
      inputBuffer = inputBuffer.replace(F10_SEQ, '');

      // Forward any remaining buffered input to PTY first
      if (inputBuffer.length > 0 && ptyProcess) {
        ptyProcess.write(inputBuffer);
        inputBuffer = '';
      }

      // Handle F10
      isProcessingFunctionKey = true;
      try {
        await options.onF10();
      } finally {
        isProcessingFunctionKey = false;
      }
      return;
    }

    // If buffer starts with escape but isn't complete, wait for more
    if (inputBuffer.startsWith('\x1b') && inputBuffer.length < 5) {
      // Use a short timeout to flush incomplete sequences
      setTimeout(() => {
        if (inputBuffer.length > 0 && ptyProcess) {
          ptyProcess.write(inputBuffer);
          inputBuffer = '';
        }
      }, 50);
      return;
    }

    // Forward everything to PTY
    if (ptyProcess && inputBuffer.length > 0) {
      ptyProcess.write(inputBuffer);
      inputBuffer = '';
    }
  };

  process.stdin.on('data', stdinHandler);

  // Implement wrapper methods
  emitter.write = (data: string) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  };

  emitter.resize = (cols: number, rows: number) => {
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  };

  emitter.kill = (signal?: string) => {
    if (ptyProcess) {
      ptyProcess.kill(signal);
      ptyProcess = null;
    }
    // Cleanup stdin - remove handler to prevent stacking on switch
    process.stdin.removeListener('data', stdinHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdout.removeListener('resize', handleResize);
  };

  emitter.getPty = () => ptyProcess;

  emitter.pauseOutput = () => {
    outputPaused = true;
  };

  emitter.resumeOutput = () => {
    outputPaused = false;
  };

  emitter.setCommandInputHandler = (handler: CommandInputHandler | null) => {
    commandInputHandler = handler;
  };

  emitter.triggerRedraw = () => {
    // Send current terminal size to PTY to trigger a redraw
    if (ptyProcess && process.stdout.columns && process.stdout.rows) {
      ptyProcess.resize(process.stdout.columns, process.stdout.rows);
    }
  };

  return emitter;
}

/**
 * Check if PTY is supported on this platform
 */
export function isPtySupported(): boolean {
  try {
    // node-pty should work on macOS, Linux, and Windows
    return true;
  } catch {
    return false;
  }
}

/**
 * Cleanup function to restore terminal state
 */
export function cleanupTerminal(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}
