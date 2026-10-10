import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';

const descendant = spawn(process.execPath, [new URL('./resistant-child.mjs', import.meta.url).pathname], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const [ack] = await once(descendant, 'message');
if (!ack.ready) throw new Error('Missing descendant readiness acknowledgement.');
writeFileSync(process.env.OWNED_LEADER_RECORD, JSON.stringify({ leader: process.pid, descendant: descendant.pid, ready: ack.ready }));
if (process.env.OWNED_LEADER_MODE === 'natural') process.exit(17);
process.on('SIGTERM', () => { console.log('owned leader stopping'); process.exit(0); });
setInterval(() => {}, 1000);
