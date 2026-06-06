/**
 * Unit tests for src/utils/files.ts
 *
 * Tests path expansion and config path resolution.
 * These are critical for cross-platform compatibility.
 */

import * as os from 'os';
import * as path from 'path';
import { expandPath, getClaudeConfigPath } from '../../src/utils/files';

describe('expandPath', () => {
  const homeDir = os.homedir();

  test('expands ~ to home directory', () => {
    const result = expandPath('~/.claude');
    expect(result).toBe(path.join(homeDir, '.claude'));
  });

  test('expands ~/subdir/file correctly', () => {
    const result = expandPath('~/some/nested/path');
    expect(result).toBe(path.join(homeDir, 'some', 'nested', 'path'));
  });

  test('expands lone ~ to home directory', () => {
    const result = expandPath('~');
    // path.join(homeDir, '') returns homeDir with trailing separator removed
    expect(result).toBe(homeDir);
  });

  test('returns absolute path unchanged', () => {
    const absolutePath = path.join(homeDir, 'absolute', 'path');
    const result = expandPath(absolutePath);
    expect(result).toBe(absolutePath);
  });

  test('returns relative path unchanged (no ~)', () => {
    const result = expandPath('relative/path');
    expect(result).toBe('relative/path');
  });

  test('does not expand ~ in middle of path', () => {
    const result = expandPath('/some/path/~/here');
    expect(result).toBe('/some/path/~/here');
  });

  test('handles empty string', () => {
    const result = expandPath('');
    expect(result).toBe('');
  });
});

describe('getClaudeConfigPath', () => {
  const homeDir = os.homedir();

  test('default ~/.claude returns ~/.claude.json (special case)', () => {
    const result = getClaudeConfigPath('~/.claude');
    expect(result).toBe(path.join(homeDir, '.claude.json'));
  });

  test('non-default dir returns <dir>/.claude.json', () => {
    const result = getClaudeConfigPath('~/.claude2');
    expect(result).toBe(path.join(homeDir, '.claude2', '.claude.json'));
  });

  test('non-default dir with different name', () => {
    const result = getClaudeConfigPath('~/.claude-work');
    expect(result).toBe(path.join(homeDir, '.claude-work', '.claude.json'));
  });

  test('works with already expanded path for default dir', () => {
    const expandedDefault = path.join(homeDir, '.claude');
    const result = getClaudeConfigPath(expandedDefault);
    expect(result).toBe(path.join(homeDir, '.claude.json'));
  });

  test('works with already expanded path for non-default dir', () => {
    const expandedPath = path.join(homeDir, '.claude2');
    const result = getClaudeConfigPath(expandedPath);
    expect(result).toBe(path.join(homeDir, '.claude2', '.claude.json'));
  });
});
