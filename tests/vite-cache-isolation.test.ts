import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { availablePort } from './helpers/subprocess.ts';

test('owned Vite servers isolate optimized dependencies across shared installations and checkout ports', { timeout: 30000 }, async () => {
  mkdirSync(resolve('.runs'), { recursive: true });
  const directory = mkdtempSync(resolve('.runs/vite-cache-isolation-'));
  const dependencies = join(directory, 'shared/node_modules');
  mkdirSync(dependencies, { recursive: true });
  for (const name of readdirSync('node_modules').filter(name => !name.startsWith('.'))) symlinkSync(resolve('node_modules', name), join(dependencies, name));
  const roots = ['first', 'second'].map(name => join(directory, name));
  for (const root of roots) {
    mkdirSync(root, { recursive: true });
    symlinkSync(dependencies, join(root, 'node_modules'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(root, 'vite.config.ts'), readFileSync('vite.config.ts'));
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/entry.js"></script>');
    writeFileSync(join(root, 'entry.js'), 'import React from "react"; window.ReactVersion = React.version;');
  }
  const servers: ViteDevServer[] = [];
  const logs: string[] = [];
  const result: Record<string, unknown> = { directory, roots, sharedDependencies: dependencies };
  const start = async (root: string) => {
    const port = await availablePort();
    const previousPort = process.env.UI_PORT;
    process.env.UI_PORT = port;
    const logger = createLogger('silent');
    for (const level of ['info', 'warn', 'error'] as const) logger[level] = message => { logs.push(`${root}:${port} ${level}: ${message}`); };
    let server: ViteDevServer;
    try { server = await createServer({ root, clearScreen: false, customLogger: logger }); }
    finally {
      if (previousPort === undefined) delete process.env.UI_PORT;
      else process.env.UI_PORT = previousPort;
    }
    servers.push(server);
    await server.listen();
    const baseURL = `http://127.0.0.1:${port}`;
    const transformed = await server.transformRequest('/entry.js');
    assert.ok(transformed, 'Vite must transform the real dependency import.');
    const optimizer = server.environments.client.depsOptimizer;
    assert.ok(optimizer);
    await optimizer.scanProcessing;
    const discovered = optimizer.metadata.discovered.react ?? optimizer.metadata.optimized.react;
    assert.ok(discovered, 'Dependency transformation must discover React.');
    optimizer.run();
    await discovered.processing;
    const optimized = optimizer.metadata.optimized.react;
    assert.ok(optimized, 'The actual optimizer must produce the React dependency.');
    const dependencyURL = `${baseURL}/@fs/${optimized.file}?v=${optimized.browserHash}`;
    const metadataPath = join(server.config.cacheDir, 'deps/_metadata.json');
    const metadata = readFileSync(metadataPath, 'utf8');
    const dependencyStatus = (await fetch(dependencyURL)).status;
    assert.equal(dependencyStatus, 200, 'Each owned frontend must serve its original optimized dependency successfully before the collision probe.');
    return { dependencyURL, metadataPath, metadata, cacheDir: server.config.cacheDir, physicalCacheDir: realpathSync(server.config.cacheDir), baseURL, dependencyStatus };
  };
  try {
    const first = await start(roots[0]);
    result.first = { cacheDir: first.cacheDir, physicalCacheDir: first.physicalCacheDir, dependencyURL: first.dependencyURL, dependencyStatus: first.dependencyStatus };
    const second = await start(roots[1]);
    result.second = { cacheDir: second.cacheDir, physicalCacheDir: second.physicalCacheDir, dependencyURL: second.dependencyURL, dependencyStatus: second.dependencyStatus };
    const afterSecond = { metadataUnchanged: readFileSync(first.metadataPath, 'utf8') === first.metadata, dependencyStatus: (await fetch(first.dependencyURL)).status };
    result.afterSecond = afterSecond;
    const anotherPort = await start(roots[0]);
    result.anotherPort = { cacheDir: anotherPort.cacheDir, physicalCacheDir: anotherPort.physicalCacheDir, dependencyURL: anotherPort.dependencyURL, dependencyStatus: anotherPort.dependencyStatus };
    const afterAnotherPort = { metadataUnchanged: readFileSync(first.metadataPath, 'utf8') === first.metadata, dependencyStatus: (await fetch(first.dependencyURL)).status };
    result.afterAnotherPort = afterAnotherPort;
    assert.equal(afterSecond.dependencyStatus, 200, `Starting another checkout must retain the first server's optimized dependency: ${directory}`);
    assert.equal(afterSecond.metadataUnchanged, true, 'Another checkout must not replace the first optimizer metadata.');
    assert.notEqual(first.physicalCacheDir, second.physicalCacheDir, 'Separate checkouts sharing installed packages require physically distinct generated caches.');
    assert.equal(afterAnotherPort.dependencyStatus, 200, 'Another owned port in the same checkout must retain the first optimized dependency.');
    assert.equal(afterAnotherPort.metadataUnchanged, true, 'Another owned port must not replace the first optimizer metadata.');
    assert.notEqual(first.physicalCacheDir, anotherPort.physicalCacheDir, 'Different frontend ports in the same checkout require separate generated caches.');
    assert.equal(existsSync(join(dependencies, '.vite')), false, 'Owned frontends must keep generated optimizer caches outside their shared dependency installation.');
  } finally {
    for (const server of servers.reverse()) await server.close();
    writeFileSync(join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(directory, 'vite.log'), `${logs.join('\n')}\n`);
  }
});
