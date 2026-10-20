import { readFileSync } from 'node:fs';
import { resolveDatabasePath } from '../src/instance.ts';

const url = `http://127.0.0.1:${process.env.API_PORT ?? 4310}/api/health`;
const expectedVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
try {
  const expectedDatabase = resolveDatabasePath(process.env.DB_PATH ?? '.data/issues.sqlite');
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Health returned HTTP ${response.status}`);
  const health = await response.json();
  if (health.status !== 'ok' || health.databasePath !== expectedDatabase || health.version !== expectedVersion) throw new Error('The running instance does not match this checkout and database.');
  if (process.env.INSTANCE_ID && health.instanceId !== process.env.INSTANCE_ID) throw new Error('Instance ID does not match.');
  console.log(JSON.stringify({ healthy: true, url, ...health }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ healthy: false, url, error: error.message }));
  process.exitCode = 1;
}
