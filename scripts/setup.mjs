import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer.');
for (const args of [['ci'], ['exec', '--', 'playwright', 'install', 'chromium']]) {
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync('.data', { recursive: true });
console.log('Setup complete. Run npm run dev. The database is created on startup; use npm run reset -- --confirm to load disposable demo issues.');
