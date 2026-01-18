import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../config';
import { copyFile, copyDirectory, fileExists, ensureDir, getModifiedTime, deleteRecursive } from '../utils/files';

/**
 * Extensions Sync Engine
 *
 * Syncs agents, commands, and skills from master folder to all accounts.
 * Master folder is the ONLY source of truth (one-way sync).
 *
 * Extension types:
 * - agents/: Markdown files (*.md)
 * - commands/: Markdown files (*.md)
 * - skills/: Directories containing SKILL.md and other files
 *
 * Sync behavior:
 * 1. Copy from master -> all accounts (add/update)
 * 2. Delete from accounts if not in master
 */

type ExtensionType = 'agents' | 'commands' | 'skills';

interface SyncStats {
  copied: number;
  updated: number;
  deleted: number;
}

const EXTENSION_TYPES: ExtensionType[] = ['agents', 'commands', 'skills'];

/**
 * Get all extension items (files or directories) for a given type
 * For agents/commands: returns markdown file names
 * For skills: returns directory names
 */
function getExtensionItems(basePath: string, extensionType: ExtensionType): string[] {
  const extensionDir = path.join(basePath, extensionType);

  if (!fs.existsSync(extensionDir)) {
    return [];
  }

  const entries = fs.readdirSync(extensionDir, { withFileTypes: true });

  if (extensionType === 'skills') {
    // Skills are directories
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } else {
    // Agents and commands are markdown files
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  }
}

/**
 * Get the full path to an extension item
 */
function getExtensionPath(basePath: string, extensionType: ExtensionType, itemName: string): string {
  return path.join(basePath, extensionType, itemName);
}

/**
 * Check if an extension item is newer than another
 * For skills (directories), compares the most recent file modification time
 */
function isNewer(sourcePath: string, targetPath: string): boolean {
  if (!fileExists(targetPath)) {
    return true;
  }

  const sourceTime = getLatestModTime(sourcePath);
  const targetTime = getLatestModTime(targetPath);

  // Use second precision for comparison
  return Math.floor(sourceTime / 1000) > Math.floor(targetTime / 1000);
}

/**
 * Get the latest modification time for a path
 * For directories, recursively finds the newest file
 */
function getLatestModTime(itemPath: string): number {
  const stats = fs.statSync(itemPath);

  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let latestTime = stats.mtimeMs;
  const entries = fs.readdirSync(itemPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = path.join(itemPath, entry.name);
    const entryTime = getLatestModTime(entryPath);

    if (entryTime > latestTime) {
      latestTime = entryTime;
    }
  }

  return latestTime;
}

/**
 * Copy an extension item (file or directory)
 */
function copyExtensionItem(sourcePath: string, targetPath: string): void {
  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    // Delete existing target directory first for clean copy
    if (fs.existsSync(targetPath)) {
      deleteRecursive(targetPath);
    }
    copyDirectory(sourcePath, targetPath);
  } else {
    ensureDir(path.dirname(targetPath));
    copyFile(sourcePath, targetPath);
  }
}

/**
 * Sync from master to accounts
 * Copy all master extensions to all accounts (overwrite if newer)
 */
function syncMasterToAccounts(
  config: Config,
  extensionType: ExtensionType,
  verbose: boolean
): { copied: number; updated: number } {
  const stats = { copied: 0, updated: 0 };
  const masterItems = getExtensionItems(config.masterFolder, extensionType);

  for (const itemName of masterItems) {
    const masterPath = getExtensionPath(config.masterFolder, extensionType, itemName);

    for (const [accountName, accountPath] of Object.entries(config.accounts)) {
      const accountItemPath = getExtensionPath(accountPath, extensionType, itemName);
      const accountExtDir = path.join(accountPath, extensionType);

      // Ensure extension directory exists in account
      ensureDir(accountExtDir);

      if (!fileExists(accountItemPath)) {
        // Copy new item
        copyExtensionItem(masterPath, accountItemPath);
        stats.copied++;

        if (verbose) {
          console.log(`  [copied] ${extensionType}/${itemName} -> ${accountName}`);
        }
      } else if (isNewer(masterPath, accountItemPath)) {
        // Update existing item
        copyExtensionItem(masterPath, accountItemPath);
        stats.updated++;

        if (verbose) {
          console.log(`  [updated] ${extensionType}/${itemName} -> ${accountName}`);
        }
      }
    }
  }

  return stats;
}

/**
 * Handle deletions
 * Remove extensions from accounts that don't exist in master
 */
function handleDeletions(
  config: Config,
  extensionType: ExtensionType,
  verbose: boolean
): number {
  let deleted = 0;
  const masterItems = new Set(getExtensionItems(config.masterFolder, extensionType));

  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    const accountItems = getExtensionItems(accountPath, extensionType);

    for (const itemName of accountItems) {
      // Skip if in master
      if (masterItems.has(itemName)) {
        continue;
      }

      // Delete from account (not in master = shouldn't exist)
      const itemPath = getExtensionPath(accountPath, extensionType, itemName);
      deleteRecursive(itemPath);
      deleted++;

      if (verbose) {
        console.log(`  [deleted] ${extensionType}/${itemName} from ${accountName}`);
      }
    }
  }

  return deleted;
}

/**
 * Sync a single extension type (agents, commands, or skills)
 */
function syncExtensionType(
  config: Config,
  extensionType: ExtensionType,
  verbose: boolean
): SyncStats {
  const stats: SyncStats = { copied: 0, updated: 0, deleted: 0 };

  // Step 1: Sync from master to accounts
  const syncStats = syncMasterToAccounts(config, extensionType, verbose);
  stats.copied = syncStats.copied;
  stats.updated = syncStats.updated;

  // Step 2: Delete items in accounts that aren't in master
  stats.deleted = handleDeletions(config, extensionType, verbose);

  return stats;
}

export interface ExtensionsSyncStats {
  copied: number;
  updated: number;
  deleted: number;
}

/**
 * Sync all extensions (agents, commands, skills) across all accounts
 * Master folder is source of truth - one-way sync only
 *
 * @returns Summary stats: { copied, updated, deleted }
 */
export function syncExtensions(config: Config, verbose: boolean = false): ExtensionsSyncStats {
  if (verbose) {
    console.log('Syncing extensions (master -> accounts)...');
  }

  const totalStats: SyncStats = { copied: 0, updated: 0, deleted: 0 };

  for (const extensionType of EXTENSION_TYPES) {
    if (verbose) {
      console.log(`\n${extensionType}:`);
    }

    const stats = syncExtensionType(config, extensionType, verbose);
    totalStats.copied += stats.copied;
    totalStats.updated += stats.updated;
    totalStats.deleted += stats.deleted;
  }

  if (verbose) {
    console.log(`\nExtensions sync complete:`);
    console.log(`  - Copied from master: ${totalStats.copied}`);
    console.log(`  - Updated from master: ${totalStats.updated}`);
    console.log(`  - Removed (not in master): ${totalStats.deleted}`);
  }

  return {
    copied: totalStats.copied,
    updated: totalStats.updated,
    deleted: totalStats.deleted,
  };
}

/**
 * List all extensions for debugging
 */
export function listExtensions(config: Config): void {
  console.log('\nExtensions:\n');

  console.log('Master folder:');
  for (const extensionType of EXTENSION_TYPES) {
    const items = getExtensionItems(config.masterFolder, extensionType);
    console.log(`  ${extensionType}/: ${items.length} items`);
    for (const item of items) {
      console.log(`    - ${item}`);
    }
  }

  console.log('\nAccounts:');
  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    console.log(`\n  ${accountName}:`);
    for (const extensionType of EXTENSION_TYPES) {
      const items = getExtensionItems(accountPath, extensionType);
      console.log(`    ${extensionType}/: ${items.length} items`);
    }
  }
}
