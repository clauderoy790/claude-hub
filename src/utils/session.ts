/**
 * Session helpers shared across launch paths.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Find the active session ID by the most recent message timestamp across the
 * project's conversation files. More reliable than file mtime, which sync
 * operations change.
 */
export function findActiveSessionId(configDir: string): string | null {
  try {
    const cwd = process.cwd();
    // Project dir name format used by Claude Code:
    //   macOS:   /Users/me/code -> -Users-me-code
    //   Windows: C:\Git\code    -> C--Git-code
    let projectDirName: string;
    if (process.platform === 'win32') {
      projectDirName = cwd.replace(/:/g, '-').replace(/\\/g, '-');
    } else {
      projectDirName = '-' + cwd.slice(1).replace(/\//g, '-');
    }
    const projectPath = path.join(configDir, 'projects', projectDirName);

    if (!fs.existsSync(projectPath)) {
      return null;
    }

    const files = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl') && !f.includes('/'));

    if (files.length === 0) {
      return null;
    }

    let latestTimestamp = '';
    let latestSessionId: string | null = null;

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const sessionId = file.replace('.jsonl', '');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');

        // Search from the end for an entry with a timestamp.
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.timestamp) {
              // ISO timestamps compare correctly as strings.
              if (entry.timestamp > latestTimestamp) {
                latestTimestamp = entry.timestamp;
                latestSessionId = sessionId;
              }
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    return latestSessionId;
  } catch {
    return null;
  }
}
