import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import type { Plugin } from 'vite';

type Module = { code: string; imports: string[] };

function reachable(graph: Map<string, Module>, roots: string[], excluded = new Set<string>()) {
  const found = new Set<string>();
  function visit(id: string) {
    if (found.has(id) || excluded.has(id)) return;
    found.add(id);
    for (const child of graph.get(id)?.imports ?? []) visit(child);
  }
  roots.forEach(visit);
  return found;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('production UI output retains application assets and excludes component preview modules and samples', { timeout: 60000 }, async () => {
  mkdirSync(resolve('.runs'), { recursive: true });
  const directory = mkdtempSync(resolve('.runs/ui-preview-build-'));
  const graph = new Map<string, Module>();
  const included = new Set<string>();
  const inspect: Plugin = {
    name: 'observe-preview-development-graph',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        const module = this.getModuleInfo(id);
        if (module) graph.set(id, { code: module.code ?? '', imports: [...module.importedIds, ...module.dynamicallyImportedIds] });
      }
    },
  };
  await build({ configLoader: 'native', mode: 'development', logLevel: 'silent', define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false' }, plugins: [inspect], build: { write: false } });
  const previewRoots = [...graph].filter(([id, module]) => id.includes('/src/ui/') && /(['"])Open preview dialog\1/i.test(module.code)).map(([id]) => id);
  const applicationRoots = [...graph.keys()].filter(id => id.endsWith('/src/ui/main.tsx'));
  const application = reachable(graph, applicationRoots, new Set(previewRoots));
  const previewOnly = [...reachable(graph, previewRoots)].filter(id => !application.has(id));
  const output = join(directory, 'production');
  await build({ configLoader: 'native', mode: 'production', logLevel: 'silent', build: { outDir: output, emptyOutDir: true }, plugins: [{
    name: 'observe-production-modules',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') for (const [id, details] of Object.entries(item.modules)) if (details.renderedLength > 0) included.add(id);
      }
    },
  }] });
  const artifacts = files(output);
  writeFileSync(join(directory, 'observations.json'), `${JSON.stringify({ previewRoots, previewOnly, included: [...included], artifacts }, null, 2)}\n`);
  const html = readFileSync(join(output, 'index.html'), 'utf8');
  assert.match(html, /<div\b[^>]*id="root"/, 'The production artifact must retain the application mount.');
  assert.match(html, /<script\b[^>]*type="module"[^>]*src="[^"]+\.js"/, 'Production must emit and load a real application entry chunk.');
  assert.match(html, /<link\b[^>]*rel="stylesheet"/, 'Browser styles must remain loaded by the built browser entry.');
  assert.ok([...included].some(id => application.has(id) && id.includes('/src/ui/') && !applicationRoots.includes(id)), 'The real application UI must remain in the emitted module graph, including when compatibility entry points become re-exports.');
  assert.ok(artifacts.some(path => path.endsWith('.css')), 'The production browser stylesheet must still be emitted.');
  assert.deepEqual(previewOnly.filter(id => included.has(id)), [], 'No preview-only module or transitive sample/fixture dependency may be included in any production chunk.');
  for (const path of artifacts) {
    const content = readFileSync(path).toString('utf8');
    assert.doesNotMatch(content, /Open preview dialog|Long content sample|Preview sample item|No sample items|Sample read failed/i, `The emitted artifact ${path} must exclude preview UI and sample content.`);
  }
});
