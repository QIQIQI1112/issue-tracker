import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { IssueStore } from '../src/storage.ts';
import type { Repo } from '../src/workflow.ts';
import { harnessRepository } from '../tests/repository-harness-fixture.ts';

export function repositoryFixture(info: TestInfo) {
  const prefix = `Repository-${randomUUID()}`;
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const a = harnessRepository(info.outputPath('repos', 'alpha'), `${prefix}-ALPHA`);
  const b = harnessRepository(info.outputPath('repos', 'beta'), `${prefix}-BETA`);
  const first = store.work.addRepo({ name: `${prefix} ${'long-repository-name-'.repeat(3)}Alpha`, path: a.path, targetBranch: 'main' });
  const second = store.work.addRepo({ name: `${prefix} Beta`, path: b.path, targetBranch: 'main' });
  const create = (title: string, repo: Repo | null, status: 'open' | 'done', labels: string[], priority: 'high' | 'low' = 'low') => store.create({ title: `${prefix} ${title}`, description: `${prefix} description-search`, status, labels, priority, ...(repo ? { work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Read repository-scoped issues.'] } } : {}) });
  const alpha = create('Alpha open', first, 'open', ['alpha-only', 'shared']);
  const zulu = create('Zulu open', first, 'open', ['alpha-only'], 'high');
  const done = create('Done alpha', first, 'done', ['completed-only']);
  const beta = create('Beta open', second, 'open', ['beta-only']);
  const unassigned = create('Unassigned record', null, 'open', ['unassigned-only']);
  const issues = [alpha, zulu, done, beta, unassigned];
  return { prefix, store, a, b, first, second, alpha, zulu, done, beta, unassigned, issues, close: () => {
    for (const issue of issues) store.delete(issue.id);
    store.close();
    const database = new DatabaseSync(info.project.metadata.databasePath as string);
    try { database.prepare('DELETE FROM repos WHERE id IN (?, ?)').run(first.id, second.id); }
    finally { database.close(); }
  } };
}

export const repositoryGroup = (page: Page) => page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true });
export const repositoryButton = (page: Page, repo: Repo | null) => repositoryGroup(page).getByRole('button', { name: repo?.name ?? 'All repositories', exact: true });
export const subview = (page: Page, name: 'Issues' | 'Repo harness') => page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('button', { name, exact: true }).or(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('link', { name, exact: true }));

export async function chooseRepository(page: Page, repo: Repo | null) {
  await repositoryButton(page, repo).click();
  await expect(repositoryButton(page, repo)).toHaveAttribute('aria-pressed', 'true');
  await expect(repositoryGroup(page).locator('button[aria-pressed="true"]')).toHaveCount(1);
}

export async function chooseSubview(page: Page, name: 'Issues' | 'Repo harness') {
  await subview(page, name).click();
  await expect(subview(page, name)).toHaveAttribute('aria-current', /^(?:page|true)$/);
  await expect(page.getByRole('main').getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}

export function observeRepositoryReads(page: Page) {
  const forbidden: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) || /\/api\/.*\/(?:start|retry|execute)(?:\/|$)/.test(path)) forbidden.push(`${request.method()} ${path}`);
  });
  return () => expect(forbidden, 'Repository navigation, diagnostics and read retries must never mutate or execute work.').toEqual([]);
}
