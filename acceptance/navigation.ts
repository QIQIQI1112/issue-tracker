import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Repo } from '../src/workflow.ts';

function controls(page: Page) {
  return {
    legacy: page.getByLabel('Filter by repository', { exact: true }),
    repositories: page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('group', { name: 'Repositories', exact: true }),
  };
}

export async function expectRepositoryControl(page: Page) {
  const { legacy, repositories } = controls(page);
  await expect(legacy.or(repositories)).toBeVisible();
  if (await repositories.count()) await expect(repositories.getByRole('button', { name: 'All repositories', exact: true })).toBeVisible();
}

async function repositoryButton(page: Page, id: number | '') {
  const { repositories } = controls(page);
  let name = 'All repositories';
  if (id !== '') {
    const response = await page.request.get(new URL('/api/repos', page.url()).href);
    expect(response.status()).toBe(200);
    const { repos } = await response.json() as { repos: Repo[] };
    const repo = repos.find(item => item.id === id);
    expect(repo, `Repository ${id} must exist in the owned registry.`).toBeDefined();
    name = repo!.name;
  }
  return repositories.getByRole('button', { name, exact: true });
}

export async function expectRepositorySelection(page: Page, id: number | '') {
  await expectRepositoryControl(page);
  const { legacy } = controls(page);
  if (await legacy.count()) await expect(legacy).toHaveValue(String(id));
  else await expect(await repositoryButton(page, id)).toHaveAttribute('aria-pressed', 'true');
}

export async function selectRepository(page: Page, id: number | '') {
  await expectRepositoryControl(page);
  const { legacy } = controls(page);
  if (await legacy.count()) await legacy.selectOption(String(id));
  else await (await repositoryButton(page, id)).click();
  await expectRepositorySelection(page, id);
}

export async function expectStatusSelection(page: Page, status: 'all' | 'open' | 'in_progress' | 'done') {
  await expectRepositoryControl(page);
  await expect(page.getByLabel('Filter by status', { exact: true })).toHaveValue(status);
  if (!(await controls(page).repositories.count())) {
    const name = { all: 'All issues', open: 'Open', in_progress: 'In progress', done: 'Done' }[status];
    await expect(page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
}

export async function selectStatus(page: Page, status: 'all' | 'open' | 'in_progress' | 'done') {
  await expectRepositoryControl(page);
  if (await controls(page).repositories.count()) await page.getByLabel('Filter by status', { exact: true }).selectOption(status);
  else {
    const name = { all: 'All issues', open: 'Open', in_progress: 'In progress', done: 'Done' }[status];
    await page.getByRole('navigation', { name: 'Workspace views', exact: true }).getByRole('button', { name, exact: true }).click();
  }
  await expectStatusSelection(page, status);
}
