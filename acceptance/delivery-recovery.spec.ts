import { selectRepository } from './navigation.ts';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availablePort, launch, stop } from './owned-server.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';
import { fixtureAgent, fixtureRepository } from '../tests/helpers/factory-fixture.ts';
import { SerialQueue } from '../factory/queue.ts';
import { IssueStore } from '../src/storage.ts';

test('a resumed real issue exposes recovery, final review, and phase durations in its delivery', async ({ page }, info) => {
  test.setTimeout(60000);
  const repository = fixtureRepository(info.outputPath('recovery-repository'));
  const databasePath = resolve(info.outputPath('owned-recovery.sqlite'));
  const identity = `recovery-${randomUUID()}`;
  const running = await launch(await availablePort(), databasePath, identity);
  const store = new IssueStore(databasePath);
  await page.context().setExtraHTTPHeaders({ [targetHeader]: targetIdentity(identity, databasePath) });
  try {
    const repo = store.work.addRepo({ name: 'Recovery evidence', path: repository, targetBranch: 'main' });
    const issue = store.create({ title: 'Recover accepted source', description: 'Return ready and retain the interrupted draft.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['The exported value is ready.'] } });
    const delegate = fixtureAgent();
    let interrupted = false;
    const queue = new SerialQueue(store, { agent: { run: async input => {
      if (input.phase === 'implement' && !interrupted) {
        interrupted = true;
        writeFileSync(join(input.cwd, 'src/retained.ts'), 'export const retained = true;\n');
        throw new Error('Injected interruption after an accepted draft.');
      }
      return await delegate.run(input);
    } } });
    store.work.startIssue(issue.id);
    expect(await queue.processNext()).toBe(true);
    const previous = store.work.runs().find(run => run.issueId === issue.id)!;
    expect(previous.status).toBe('blocked');
    store.work.startIssue(issue.id);
    expect(await queue.processNext()).toBe(true);
    expect(store.get(issue.id)?.status).toBe('done');
    await page.goto(running.url);
    await selectRepository(page, repo.id);
    await page.getByRole('button', { name: 'View issue Recover accepted source', exact: true }).click();
    const report = page.getByRole('dialog').getByRole('article', { name: 'Delivery report', exact: true });
    await expect(report.getByRole('heading', { name: 'Execution timeline', exact: true })).toBeVisible();
    await expect(report.getByRole('heading', { name: 'Recovery', exact: true })).toBeVisible();
    await expect(report.getByText(previous.id, { exact: true })).toBeVisible();
    await expect(report.getByText('repair', { exact: true })).toBeVisible();
    await expect(report.getByText('integrated-code', { exact: true })).toBeVisible();
    await expect(report.getByText(/Cumulative implementation attempts: 2\/3/)).toBeVisible();
    await report.getByText(/^Evidence \(/).click();
    await expect(report.getByRole('link', { name: 'checkpoint.patch', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('recovery-report.png'), fullPage: true });
  } finally {
    store.close();
    await stop(running.child);
  }
});
