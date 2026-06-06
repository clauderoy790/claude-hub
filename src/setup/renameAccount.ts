/**
 * Rename Account Command
 *
 * Handles `hub --rename-account <old> <new>` to rename an existing account.
 * - Validates new account name
 * - Checks old account exists
 * - Checks new name doesn't conflict
 * - Updates config.json
 *
 * Note: This only renames the account in config.json. The underlying
 * config directory (e.g., ~/.claude-work) is NOT renamed, since that
 * would require updating keychain entries and other references.
 */

import { Config, saveConfig } from '../config';
import { validateAccountName } from './addAccount';

export interface RenameResult {
  success: boolean;
  error?: string;
}

/**
 * Rename an account in the configuration
 *
 * @param oldName - Current account name
 * @param newName - New account name
 * @param config - Current configuration
 * @returns Result indicating success or failure with error message
 */
export function renameAccount(oldName: string, newName: string, config: Config): RenameResult {
  // Validate old name exists
  if (!config.accounts[oldName]) {
    return {
      success: false,
      error: `Account "${oldName}" does not exist. Available accounts: ${Object.keys(config.accounts).join(', ')}`,
    };
  }

  // Check old and new are different (before other validation)
  if (oldName === newName) {
    return {
      success: false,
      error: `Old and new names are the same.`,
    };
  }

  // Validate new name format
  const validation = validateAccountName(newName);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  // Check new name doesn't already exist
  if (config.accounts[newName]) {
    return {
      success: false,
      error: `Account "${newName}" already exists. Choose a different name.`,
    };
  }

  // Perform the rename - preserve the config directory path
  const configDir = config.accounts[oldName];
  delete config.accounts[oldName];
  config.accounts[newName] = configDir;

  // Save the updated config
  saveConfig(config);

  return { success: true };
}

/**
 * CLI handler for --rename-account command
 */
export function handleRenameAccount(oldName: string, newName: string, config: Config): boolean {
  const result = renameAccount(oldName, newName, config);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    return false;
  }

  console.log(`✓ Renamed account "${oldName}" to "${newName}"`);
  return true;
}
