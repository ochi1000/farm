const { spawn } = require('node:child_process');
const path = require('node:path');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const root = path.resolve(__dirname, '..');
const userData = path.join(root, '.desktop-data');
const cache = path.join(userData, 'cache');

const child = spawn(electronPath, [
  `--user-data-dir=${userData}`,
  `--disk-cache-dir=${cache}`,
  'desktop/main.cjs'
], {
  stdio: 'inherit',
  env
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
