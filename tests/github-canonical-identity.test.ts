import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { githubEnrollment } from '../src/workflow.ts';
import type { Publication } from '../src/workflow.ts';

test('GitHub PR identity accepts canonical repository casing while rejecting a different host repository or pull number', () => {
  const source = ts.createSourceFile('github.ts', readFileSync(new URL('../factory/github.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'pullIdentity');
  assert.ok(declaration, 'The regression must execute the actual publication identity validator.');
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  const validate = new Function(`${compiled}\nreturn pullIdentity;`)() as (pull: unknown, publication: Publication) => void;
  const publication: Publication = { ...githubEnrollment({ repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml' }), branch: 'codex/requirement-fixture', baseBranch: 'main', state: 'pending', headCommit: 'a'.repeat(40) };
  const pull = { number: 7, html_url: 'https://github.com/fixture/project/pull/7', state: 'open', merged: false, draft: false, head: { sha: publication.headCommit, ref: publication.branch, repo: { full_name: 'fixture/project' } }, base: { ref: 'main', repo: { full_name: 'fixture/project' } } };
  assert.doesNotThrow(() => validate(pull, publication), 'Matching enrolled spelling establishes the existing positive control.');
  for (const html_url of ['https://untrusted.example/fixture/project/pull/7', 'https://github.com/fixture/other/pull/7', 'https://github.com/fixture/project/pull/8']) {
    assert.throws(() => validate({ ...pull, html_url }, publication), 'URL host, repository and PR number remain part of the validated identity.');
  }
  const canonical = { ...pull, html_url: 'https://github.com/Fixture/Project/pull/7', head: { ...pull.head, repo: { full_name: 'Fixture/Project' } }, base: { ...pull.base, repo: { full_name: 'Fixture/Project' } } };
  assert.doesNotThrow(() => validate(canonical, publication), 'GitHub canonical owner/repository casing must not reject the otherwise identical enrolled PR.');
});
