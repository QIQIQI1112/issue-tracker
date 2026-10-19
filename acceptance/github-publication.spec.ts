import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { IssueStore } from '../src/storage.ts';
import { appUrl, test } from './workspace.ts';

test('issue diagnostics expose GitHub PR CI and final merge without treating local acceptance as delivery', async ({ page, workspace }, info) => {
  const root = info.outputPath('github-diagnostics'); mkdirSync(root, { recursive: true });
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const repo = store.work.addRepo({ name: 'GitHub diagnostic fixture', path: root, targetBranch: 'main' });
  const requirement = store.work.addRequirement({ repoId: repo.id, title: 'Publish one requirement', goal: 'Inspect remote delivery after local acceptance.' });
  const issue = await workspace.create({ title: 'GitHub delivery inspection', work: { repoId: repo.id, requirementId: requirement.id, dependsOn: [], acceptance: ['The PR and CI outcome are inspectable.'] } });
  const publication = { repository: 'fixture/project', remote: 'origin', workflow: 'verify.yml', branch: 'codex/requirement-diagnostic', baseBranch: 'main', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40), state: 'awaiting_ci', number: 7, url: 'https://github.com/fixture/project/pull/7', ciUrl: 'https://github.com/fixture/project/actions/runs/9', ciRunId: 9, mergeCommit: '', reason: '' };
  await page.route('**/api/workbench', async route => {
    const response = await route.fetch(); const data = await response.json();
    data.requirements = data.requirements.map((item: { id: number }) => item.id === requirement.id ? { ...item, status: publication.state === 'merged' ? 'done' : publication.state === 'blocked' ? 'blocked' : 'queued', publication } : item);
    await route.fulfill({ response, json: data });
  });
  try {
    await page.goto(appUrl(info));
    await page.getByRole('button', { name: `View issue ${issue.title}`, exact: true }).click();
    const context = page.getByRole('region', { name: 'Requirement context' });
    await expect(context.getByText('Awaiting GitHub CI', { exact: true })).toBeVisible();
    await expect(context.getByRole('link', { name: 'GitHub PR #7' })).toHaveAttribute('href', publication.url);
    await expect(context.getByRole('link', { name: 'GitHub CI run' })).toHaveAttribute('href', publication.ciUrl);
    await expect(context).toContainText(publication.branch);
    await expect(context.getByText('GitHub PR merged', { exact: true })).toHaveCount(0);
    publication.state = 'blocked'; publication.reason = 'Required GitHub CI failed.';
    await expect(context.getByText('GitHub publication blocked', { exact: true })).toBeVisible();
    await expect(context).toContainText(publication.reason);
    publication.state = 'merged'; publication.reason = ''; publication.mergeCommit = 'c'.repeat(40);
    await expect(context.getByText('GitHub PR merged', { exact: true })).toBeVisible();
    await expect(context).toContainText(publication.mergeCommit);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { store.close(); }
});
