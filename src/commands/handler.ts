/**
 * Command Handler - Routes intercepted commands to their handlers
 *
 * Parses commands like /hub and /switch from user input,
 * executes the appropriate handler, and manages Claude process state.
 */

import { APIUsageData } from '../usage';

/** Input handler type for commands that need to receive keypresses */
export type InputHandler = (data: string) => void;

export interface CommandContext {
  /** Current account name */
  accountName: string;
  /** All account paths from config */
  accounts: Record<string, string>;
  /** Usage data for all accounts */
  usageData: APIUsageData[];
  /** Callback to pause Claude output */
  pauseOutput: () => void;
  /** Callback to resume Claude output */
  resumeOutput: () => void;
  /** Set a handler to receive input during command execution */
  setInputHandler: (handler: InputHandler | null) => void;
  /** Trigger PTY to redraw (sends resize signal) */
  triggerRedraw: () => void;
  /** Callback to switch accounts */
  switchAccount?: (accountName: string, resumeSession: boolean) => void;
}

export interface CommandResult {
  /** Whether the command was handled */
  handled: boolean;
  /** Whether to suppress the input from reaching Claude */
  suppress: boolean;
  /** Optional message to display after command completes */
  message?: string;
}

export type CommandHandler = (args: string, context: CommandContext) => Promise<CommandResult>;

/** Registry of command handlers */
const commands: Map<string, CommandHandler> = new Map();

/**
 * Register a command handler
 */
export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name.toLowerCase(), handler);
}

/**
 * Check if a line is a hub command
 *
 * Commands must:
 * - Start with /
 * - Be followed by a registered command name
 * - Have nothing or whitespace before arguments
 */
export function isHubCommand(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return false;

  // Extract command name (everything between / and first whitespace)
  const spaceIndex = trimmed.indexOf(' ');
  const commandName = spaceIndex === -1
    ? trimmed.slice(1)
    : trimmed.slice(1, spaceIndex);

  return commands.has(commandName.toLowerCase());
}

/**
 * Parse and execute a command
 *
 * @param line - The full input line (e.g., "/hub" or "/switch account2")
 * @param context - Execution context with account info and callbacks
 * @returns Result indicating if command was handled and whether to suppress input
 */
export async function executeCommand(
  line: string,
  context: CommandContext
): Promise<CommandResult> {
  const trimmed = line.trim();

  if (!trimmed.startsWith('/')) {
    return { handled: false, suppress: false };
  }

  // Extract command name and args
  const spaceIndex = trimmed.indexOf(' ');
  const commandName = spaceIndex === -1
    ? trimmed.slice(1).toLowerCase()
    : trimmed.slice(1, spaceIndex).toLowerCase();
  const args = spaceIndex === -1
    ? ''
    : trimmed.slice(spaceIndex + 1).trim();

  const handler = commands.get(commandName);
  if (!handler) {
    return { handled: false, suppress: false };
  }

  try {
    return await handler(args, context);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      handled: true,
      suppress: true,
      message: `Error executing /${commandName}: ${errorMsg}`,
    };
  }
}

/**
 * Get list of registered command names
 */
export function getRegisteredCommands(): string[] {
  return Array.from(commands.keys());
}
