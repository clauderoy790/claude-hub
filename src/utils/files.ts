import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Expand ~ to home directory in paths
 */
export function expandPath(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Recursively walk a directory and return all file paths
 */
export function* walkDirectory(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip hidden files like .DS_Store
    if (entry.name.startsWith('.')) {
      continue;
    }

    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath);
    } else {
      yield fullPath;
    }
  }
}

/**
 * Copy a file from source to destination
 * Creates parent directories if they don't exist
 * Preserves the source file's modification time
 */
export function copyFile(src: string, dest: string): void {
  const destDir = path.dirname(dest);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(src, dest);

  // Preserve the original modification time
  const srcStats = fs.statSync(src);
  fs.utimesSync(dest, srcStats.atime, srcStats.mtime);
}

/**
 * Copy a directory recursively
 * Preserves modification times for all files
 */
export function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip hidden files
    if (entry.name.startsWith('.')) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      // Preserve modification time
      const srcStats = fs.statSync(srcPath);
      fs.utimesSync(destPath, srcStats.atime, srcStats.mtime);
    }
  }
}

/**
 * Get file modification time
 */
export function getModifiedTime(filePath: string): number {
  return fs.statSync(filePath).mtimeMs;
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Delete a file or directory recursively
 */
export function deleteRecursive(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  if (fs.statSync(targetPath).isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
}
