import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';

const root = process.env.OWNED_REPO_ROOT;
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: root, stdio: 'inherit' });
const stubborn = spawn(process.execPath, [new URL('./resistant-child.mjs', import.meta.url).pathname], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const [ack] = await once(stubborn, 'message');
if (ack.ready !== true) throw new Error('Missing stubborn descendant readiness acknowledgement.');
const url = `http://127.0.0.1:${process.env.API_PORT}/api/health`;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const response = await fetch(url);
    const health = await response.json();
    if (health.instanceId === process.env.INSTANCE_ID) {
      writeFileSync(process.env.OWNED_LEADER_RECORD, JSON.stringify({ leader: process.pid, api: child.pid, stubborn: stubborn.pid, stubbornReady: ack.ready, health }));
      process.exit(17);
    }
  } catch {
    await new Promise(resolve => setTimeout(resolve, 50));
    continue;
  }
  await new Promise(resolve => setTimeout(resolve, 50));
}
throw new Error('Owned API child did not become ready.');
