import { spawn } from 'node:child_process';

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  const signalOwnedGroups = signal => {
    for (const child of children) {
      if (!child.pid) continue;
      // A detached group can still own descendants after its leader exits.
      try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  signalOwnedGroups('SIGTERM');
  // Keep the supervisor alive long enough for graceful cleanup, then bound it.
  setTimeout(() => signalOwnedGroups('SIGKILL'), 5000);
}
for (const command of [['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server.ts'], ['node_modules/vite/bin/vite.js']]) {
  const child = spawn(process.execPath, command, { stdio: 'inherit', detached: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
