import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { expandPath, contractPath } from './utils/files';

export interface Config {
  accounts: Record<string, string>;
  masterFolder: string;
  syncOnStart: boolean;
  /**
   * Chrome profile directory per account (e.g., { cc2: "Profile 2" }).
   * Logins for that account open in that profile, so each Claude account keeps
   * its own signed-in browser. Optional — accounts without one use the default
   * browser.
   */
  chromeProfiles?: Record<string, string>;
}

const CONFIG_FILE = 'config.json';
const CONFIG_EXAMPLE = 'config.example.json';

/**
 * Get the directory where the hub script is located
 * This ensures config.json is found regardless of current working directory
 */
export function getScriptDir(): string {
  // __dirname in compiled JS points to the dist/ directory
  // We want the parent directory (project root) where config.json lives
  return path.resolve(__dirname, '..');
}

/**
 * Get the path to config.json
 */
export function getConfigPath(): string {
  return path.join(getScriptDir(), CONFIG_FILE);
}

/**
 * Check if config.json exists
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * Load configuration from config.json
 * Throws if config.json doesn't exist - use configExists() first
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found. Run 'hub' to set up.`);
  }

  const configData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configData) as Config;

  // Expand ~ in paths
  const expandedAccounts: Record<string, string> = {};
  for (const [name, accountPath] of Object.entries(config.accounts)) {
    expandedAccounts[name] = expandPath(accountPath);
  }

  return {
    ...config,
    accounts: expandedAccounts,
    masterFolder: expandPath(config.masterFolder),
  };
}

/**
 * Save configuration to config.json
 * Contracts absolute home-directory paths back to ~/... form for portability
 */
export function saveConfig(config: Config): void {
  const scriptDir = getScriptDir();
  const configPath = path.join(scriptDir, CONFIG_FILE);

  const portableAccounts: Record<string, string> = {};
  for (const [name, accountPath] of Object.entries(config.accounts)) {
    portableAccounts[name] = contractPath(accountPath);
  }

  const portable = {
    ...config,
    accounts: portableAccounts,
    masterFolder: contractPath(config.masterFolder),
  };

  fs.writeFileSync(configPath, JSON.stringify(portable, null, 2));
}

/**
 * Create master folder structure
 */
function createMasterFolder(masterPath: string): void {
  fs.mkdirSync(masterPath, { recursive: true });
  fs.mkdirSync(path.join(masterPath, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(masterPath, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(masterPath, 'skills'), { recursive: true });
}

/**
 * Copy directory recursively (for recreating master folder)
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip cache and debug directories
    if (entry.name === 'cache' || entry.name === 'debug') {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Validate configuration
 * Check that all account paths exist
 * Auto-recreates master folder if missing
 */
export function validateConfig(config: Config): boolean {
  // Check if any accounts are configured
  if (Object.keys(config.accounts).length === 0) {
    console.error('No accounts configured.');
    console.error('Add an account with: hub --add-account <name>');
    return false;
  }

  for (const [name, accountPath] of Object.entries(config.accounts)) {
    if (!fs.existsSync(accountPath)) {
      console.error(`Account '${name}' path does not exist: ${accountPath}`);
      return false;
    }
  }

  // Auto-recreate master folder if missing
  if (!fs.existsSync(config.masterFolder)) {
    console.log(`Master folder missing: ${config.masterFolder}`);

    const defaultClaudeDir = path.join(os.homedir(), '.claude');

    if (fs.existsSync(defaultClaudeDir)) {
      console.log('Recreating from ~/.claude...');
      copyDirRecursive(defaultClaudeDir, config.masterFolder);
      console.log(`✓ Recreated master folder (copied from ~/.claude)`);
    } else {
      console.log('Creating empty master folder...');
      createMasterFolder(config.masterFolder);
      console.log(`✓ Created empty master folder`);
    }
    console.log('');
  }

  return true;
}
