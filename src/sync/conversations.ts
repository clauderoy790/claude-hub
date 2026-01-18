import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../config';
import { copyFile, ensureDir, fileExists, getModifiedTime } from '../utils/files';

/**
 * Conversation Sync Engine
 *
 * Syncs .jsonl conversation files across all Claude Code accounts.
 * Conversations are stored in: ~/.claude/projects/-Users-claude-Git-projectname/
 * Each conversation is a .jsonl file named with a UUID.
 */

interface SyncStats {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Convert project path to directory name
 * /Users/yourname/projects/myproject -> -Users-yourname-projects-myproject
 */
function projectPathToDirectoryName(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

/**
 * Get all project directories for an account
 */
function getProjectDirectories(accountPath: string): string[] {
  const projectsDir = path.join(accountPath, 'projects');

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('-'))
    .map(entry => entry.name);
}

/**
 * Get all conversation files (.jsonl) in a project directory
 */
function getConversationFiles(accountPath: string, projectDir: string): string[] {
  const projectPath = path.join(accountPath, 'projects', projectDir);

  if (!fs.existsSync(projectPath)) {
    return [];
  }

  const entries = fs.readdirSync(projectPath, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => entry.name);
}

/**
 * Sync a single conversation file from source to target account
 * Returns: 'copied' | 'updated' | 'skipped'
 */
function syncConversationFile(
  sourceAccount: string,
  targetAccount: string,
  projectDir: string,
  conversationFile: string
): 'copied' | 'updated' | 'skipped' {
  const sourcePath = path.join(sourceAccount, 'projects', projectDir, conversationFile);
  const targetPath = path.join(targetAccount, 'projects', projectDir, conversationFile);

  // Ensure target project directory exists
  ensureDir(path.dirname(targetPath));

  if (!fileExists(targetPath)) {
    // File doesn't exist in target, copy it
    copyFile(sourcePath, targetPath);
    return 'copied';
  }

  // File exists, compare modification times at second precision
  // (sub-millisecond precision isn't preserved consistently across filesystems)
  const sourceTime = Math.floor(getModifiedTime(sourcePath) / 1000);
  const targetTime = Math.floor(getModifiedTime(targetPath) / 1000);

  if (sourceTime > targetTime) {
    // Source is newer, update target
    copyFile(sourcePath, targetPath);
    return 'updated';
  }

  // Target is same or newer, skip
  return 'skipped';
}

/**
 * Sync all conversations from one account to another
 */
function syncAccountPair(
  sourceAccount: string,
  targetAccount: string,
  verbose: boolean = false
): SyncStats {
  const stats: SyncStats = { copied: 0, updated: 0, skipped: 0 };

  const projectDirs = getProjectDirectories(sourceAccount);

  for (const projectDir of projectDirs) {
    const conversationFiles = getConversationFiles(sourceAccount, projectDir);

    for (const conversationFile of conversationFiles) {
      const result = syncConversationFile(sourceAccount, targetAccount, projectDir, conversationFile);
      stats[result]++;

      if (verbose && result !== 'skipped') {
        console.log(`  [${result}] ${projectDir}/${conversationFile}`);
      }
    }
  }

  return stats;
}

/**
 * Sync conversations across all accounts
 * Uses bidirectional sync: each account syncs TO all other accounts
 *
 * @returns Summary stats: { copied, updated, skipped }
 */
export function syncConversations(config: Config, verbose: boolean = false): SyncStats {
  const accounts = Object.entries(config.accounts);
  const totalStats: SyncStats = { copied: 0, updated: 0, skipped: 0 };

  if (verbose) {
    console.log('Syncing conversations...');
  }

  // For each source account, sync to all other target accounts
  for (const [sourceName, sourcePath] of accounts) {
    for (const [targetName, targetPath] of accounts) {
      // Skip syncing to itself
      if (sourceName === targetName) {
        continue;
      }

      if (verbose) {
        console.log(`\n${sourceName} -> ${targetName}:`);
      }

      const stats = syncAccountPair(sourcePath, targetPath, verbose);
      totalStats.copied += stats.copied;
      totalStats.updated += stats.updated;
      totalStats.skipped += stats.skipped;
    }
  }

  if (verbose) {
    console.log(`\nConversation sync complete:`);
    console.log(`  - Copied: ${totalStats.copied} new conversations`);
    console.log(`  - Updated: ${totalStats.updated} conversations`);
    console.log(`  - Skipped: ${totalStats.skipped} (already up to date)`);
  }

  return totalStats;
}

/**
 * List all conversations across all accounts (for debugging)
 */
export function listConversations(config: Config): void {
  console.log('\nConversations by account:\n');

  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    console.log(`${accountName} (${accountPath}):`);

    const projectDirs = getProjectDirectories(accountPath);

    if (projectDirs.length === 0) {
      console.log('  No projects found');
      continue;
    }

    for (const projectDir of projectDirs) {
      const conversationFiles = getConversationFiles(accountPath, projectDir);
      console.log(`  ${projectDir}: ${conversationFiles.length} conversations`);
    }

    console.log('');
  }
}
