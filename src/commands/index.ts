/**
 * Commands module exports
 *
 * Registers all hub commands and exports the handler interface.
 */

// Import commands to register them
import './hub';
import './switch';

// Export handler interface
export {
  registerCommand,
  isHubCommand,
  executeCommand,
  getRegisteredCommands,
  CommandContext,
  CommandResult,
  CommandHandler,
  InputHandler,
} from './handler';
