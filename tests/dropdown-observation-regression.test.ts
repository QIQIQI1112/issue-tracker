import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Fixture } from './dropdown-fixture.ts';
import { declarations, effective, length } from './dropdown-styles.ts';

test('selection paint rejects an indicator whose only path is hidden', async () => {
  const source = ts.createSourceFile('dropdown-theme.test.ts', readFileSync(new URL('./dropdown-theme.test.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['visible', 'selectionPaint']);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
  assert.equal(functions.length, names.size, 'The regression must exercise the actual current observer functions.');
  const compiled = ts.transpileModule(functions.map(node => node.getText(source)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  const paint = new Function('declarations', 'effective', 'length', `${compiled}\nreturn selectionPaint;`)(declarations, effective, length) as (row: HTMLElement, fixture: Fixture) => string[];
  const fixture = new Fixture();
  try {
    const row = fixture.document.createElement('div');
    row.textContent = 'Selected label';
    fixture.root.append(row);
    const baseline = paint(row, fixture);
    const svg = fixture.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('stroke', 'currentColor');
    svg.style.cssText = 'width:16px;height:16px;color:var(--accent)';
    const path = fixture.document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 6 9 17l-5-5');
    svg.append(path);
    row.append(svg);
    const changed = () => paint(row, fixture).filter(value => !baseline.includes(value));
    assert.ok(changed().length > 0, 'The real visible nonzero indicator must establish the positive control.');
    path.style.display = 'none';
    assert.deepEqual(changed(), [], 'A hidden only path must not establish visible selected paint.');
  } finally { await fixture.dispose(); }
});
