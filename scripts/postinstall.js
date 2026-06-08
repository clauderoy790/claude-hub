const { chmodSync } = require('fs');
const { join } = require('path');

// node-pty prebuilds on macOS lose the executable bit when extracted by npm.
// This restores it so the PTY wrapper can spawn processes correctly.
const prebuilds = ['darwin-arm64', 'darwin-x64'];

for (const dir of prebuilds) {
  try {
    chmodSync(join('node_modules', 'node-pty', 'prebuilds', dir, 'spawn-helper'), 0o755);
  } catch {
    // Not on macOS or prebuild not present — safe to ignore
  }
}
