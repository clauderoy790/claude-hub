import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../config';

/**
 * History.jsonl Sync Engine
 *
 * Merges history entries from all accounts into a unified history.
 * Each entry represents a conversation entry point with sessionId + timestamp as the deduplication key.
 *
 * Entry format:
 * {"display":"...", "pastedContents":{}, "timestamp":1768716900646, "project":"...", "sessionId":"uuid"}
 */

interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId: string;
}

interface SyncStats {
  entriesMerged: number;
  duplicatesRemoved: number;
  accountsProcessed: number;
}

const HISTORY_FILE = 'history.jsonl';

/**
 * Read history.jsonl from an account and parse entries
 */
function readHistoryFile(accountPath: string): HistoryEntry[] {
  const historyPath = path.join(accountPath, HISTORY_FILE);

  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const content = fs.readFileSync(historyPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.length > 0);

  const entries: HistoryEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as HistoryEntry;
      entries.push(entry);
    } catch (error) {
      // Skip malformed lines
      console.warn(`  Skipping malformed history entry: ${line.substring(0, 50)}...`);
    }
  }

  return entries;
}

/**
 * Write merged history entries to a file
 */
function writeHistoryFile(accountPath: string, entries: HistoryEntry[]): void {
  const historyPath = path.join(accountPath, HISTORY_FILE);
  const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  fs.writeFileSync(historyPath, content);
}

/**
 * Create a unique key for deduplication
 * Uses sessionId + timestamp as the composite key
 */
function createEntryKey(entry: HistoryEntry): string {
  return `${entry.sessionId}:${entry.timestamp}`;
}

/**
 * Merge history entries from all accounts
 * Deduplicates by sessionId + timestamp
 * Sorts by timestamp (newest first for display, but we'll keep chronological for file)
 */
function mergeHistoryEntries(allEntries: HistoryEntry[]): HistoryEntry[] {
  const uniqueEntries = new Map<string, HistoryEntry>();

  for (const entry of allEntries) {
    const key = createEntryKey(entry);
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, entry);
    }
  }

  // Sort by timestamp (ascending/chronological order)
  const merged = Array.from(uniqueEntries.values());
  merged.sort((a, b) => a.timestamp - b.timestamp);

  return merged;
}

export interface HistorySyncStats {
  entriesMerged: number;
}

/**
 * Sync history.jsonl across all accounts
 * Collects entries from all accounts, merges them, and writes back to all accounts
 *
 * @returns Summary stats: { entriesMerged }
 */
export function syncHistory(config: Config, verbose: boolean = false): HistorySyncStats {
  const stats: SyncStats = {
    entriesMerged: 0,
    duplicatesRemoved: 0,
    accountsProcessed: 0,
  };

  if (verbose) {
    console.log('Syncing history...');
  }

  // Collect all entries from all accounts
  const allEntries: HistoryEntry[] = [];
  let totalRawEntries = 0;

  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    const entries = readHistoryFile(accountPath);
    allEntries.push(...entries);
    totalRawEntries += entries.length;
    stats.accountsProcessed++;

    if (verbose) {
      console.log(`  ${accountName}: ${entries.length} entries`);
    }
  }

  // Merge and deduplicate
  const mergedEntries = mergeHistoryEntries(allEntries);
  stats.entriesMerged = mergedEntries.length;
  stats.duplicatesRemoved = totalRawEntries - mergedEntries.length;

  // Write merged history back to all accounts
  for (const [accountName, accountPath] of Object.entries(config.accounts)) {
    writeHistoryFile(accountPath, mergedEntries);

    if (verbose) {
      console.log(`  Wrote ${mergedEntries.length} entries to ${accountName}`);
    }
  }

  if (verbose) {
    console.log(`\nHistory sync complete:`);
    console.log(`  - Total unique entries: ${stats.entriesMerged}`);
    console.log(`  - Duplicates found during merge: ${stats.duplicatesRemoved}`);
  }

  return { entriesMerged: stats.entriesMerged };
}

/**
 * List history entries for debugging
 */
export function listHistory(config: Config, limit: number = 10): void {
  console.log('\nRecent history entries:\n');

  // Collect from all accounts and merge
  const allEntries: HistoryEntry[] = [];
  for (const accountPath of Object.values(config.accounts)) {
    allEntries.push(...readHistoryFile(accountPath));
  }

  const merged = mergeHistoryEntries(allEntries);

  // Show most recent entries
  const recent = merged.slice(-limit).reverse();

  for (const entry of recent) {
    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    const displayTruncated = entry.display.length > 50
      ? entry.display.substring(0, 50) + '...'
      : entry.display;

    console.log(`  [${dateStr}] ${displayTruncated}`);
    console.log(`    Project: ${entry.project}`);
    console.log('');
  }
}
