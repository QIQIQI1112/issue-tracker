import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

test('lint rejects comments across file types and prevents inline configuration bypasses', async (t) => {
  const cases = [
    { name: 'JavaScript line comment', filePath: 'scripts/lint-probe.js', code: '// forbidden\nconsole.log("ok");', count: 1 },
    { name: 'ES module block comment', filePath: 'scripts/lint-probe.mjs', code: 'console.log(/* forbidden */ "ok");', count: 1 },
    { name: 'CommonJS trailing comment', filePath: 'scripts/lint-probe.cjs', code: 'module.exports = "ok"; // forbidden', count: 1 },
    { name: 'TypeScript JSDoc', filePath: 'src/lint-probe.ts', code: '/** forbidden */\nexport const value = "ok";', count: 1 },
    { name: 'TypeScript ES module', filePath: 'src/lint-probe.mts', code: '// forbidden\nexport const value = "ok";', count: 1 },
    { name: 'TypeScript CommonJS module', filePath: 'src/lint-probe.cts', code: '/* forbidden */\nexport const value = "ok";', count: 1 },
    { name: 'JSX comment', filePath: 'src/ui/LintProbe.tsx', code: 'export function Probe() { return <div>{/* forbidden */}</div>; }', count: 1 },
    { name: 'TypeScript directive', filePath: 'src/lint-probe.ts', code: '// @ts-ignore\nexport const value = "ok";', count: 1 },
    { name: 'hashbang', filePath: 'scripts/lint-probe.mjs', code: '#!/usr/bin/env node\nconsole.log("ok");', count: 1 },
    { name: 'inline rule override', filePath: 'scripts/lint-probe.mjs', code: '/* eslint "local/no-comments": "off" */\n// forbidden\nconsole.log("ok");', count: 2 },
    { name: 'inline disable', filePath: 'scripts/lint-probe.mjs', code: '// eslint-disable\n/* forbidden */\nconsole.log("ok");', count: 2 },
  ];

  for (const { name, filePath, code, count } of cases) {
    await t.test(name, async () => {
      const [result] = await eslint.lintText(code, { filePath });
      const comments = result.messages.filter((message) => message.ruleId === 'local/no-comments');
      assert.equal(comments.length, count, JSON.stringify(result.messages));
      assert.ok(comments.every((message) => message.severity === 2));
    });
  }
});

test('lint rejects JavaScript mistakes, unsafe Hooks, and forbidden dependencies', async (t) => {
  const cases = [
    { name: 'undeclared variable', filePath: 'scripts/lint-probe.mjs', code: 'console.log(misspelledName);', ruleId: 'no-undef' },
    { name: 'assignment in a condition', filePath: 'scripts/lint-probe.mjs', code: 'let count = 0; if (count = 3) console.log(count);', ruleId: 'no-cond-assign' },
    { name: 'duplicate object key', filePath: 'scripts/lint-probe.mjs', code: 'console.log({ title: "first", title: "second" });', ruleId: 'no-dupe-keys' },
    { name: 'loose equality', filePath: 'src/lint-probe.ts', code: 'export function same(left: string, right: string) { return left == right; }', ruleId: 'eqeqeq' },
    { name: 'conditional Hook', filePath: 'src/ui/LintProbe.tsx', code: 'import { useState } from "react"; export function Probe({ enabled }: { enabled: boolean }) { if (enabled) useState(0); return null; }', ruleId: 'react-hooks/rules-of-hooks' },
    { name: 'missing Effect dependency', filePath: 'src/ui/LintProbe.tsx', code: 'import { useEffect } from "react"; export function Probe({ title }: { title: string }) { useEffect(() => { document.title = title; }, []); return null; }', ruleId: 'react-hooks/exhaustive-deps' },
    { name: 'frontend imports storage', filePath: 'src/ui/LintProbe.tsx', code: 'import { IssueStore } from "../storage.ts"; export const store = IssueStore;', ruleId: 'no-restricted-imports' },
    { name: 'domain imports HTTP', filePath: 'src/domain.ts', code: 'import express from "express"; export const app = express();', ruleId: 'no-restricted-imports' },
  ];

  for (const { name, filePath, code, ruleId } of cases) {
    await t.test(name, async () => {
      const [result] = await eslint.lintText(code, { filePath });
      assert.ok(result.messages.some((message) => message.ruleId === ruleId && message.severity === 2), `Expected ${ruleId}: ${JSON.stringify(result.messages)}`);
    });
  }
});

test('lint accepts valid Node globals, TypeScript types, and complete Hook dependencies', async (t) => {
  const cases = [
    { name: 'comment markers inside strings, templates, and regular expressions', filePath: 'scripts/lint-probe.mjs', code: 'console.log("https://example.com", "/* text */", `// text`, /\\/\\//.test("//"), 6 / 2);' },
    { name: 'Node ES module', filePath: 'scripts/lint-probe.mjs', code: 'console.log(process.pid, Buffer.from("ok")); setTimeout(() => console.log("done"), 1);' },
    { name: 'Node CommonJS module', filePath: 'scripts/lint-probe.cjs', code: 'module.exports = process.pid;' },
    { name: 'TypeScript types and intentionally unused parameter', filePath: 'src/lint-probe.ts', code: 'export function title(_event: Event, issue: { title: string }): string { return issue.title; }' },
    { name: 'complete Effect dependency', filePath: 'src/ui/LintProbe.tsx', code: 'import { useEffect } from "react"; export function Probe({ title }: { title: string }) { useEffect(() => { document.title = title; }, [title]); return null; }' },
  ];

  for (const { name, filePath, code } of cases) {
    await t.test(name, async () => {
      const [result] = await eslint.lintText(code, { filePath });
      assert.deepEqual(result.messages, []);
    });
  }
});
