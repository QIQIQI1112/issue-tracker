import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { saveDelivery } from '../factory/delivery.ts';
import { IssueStore } from '../src/storage.ts';
import type { Delivery } from '../src/workflow.ts';
import { recordDiagnosticRun } from './diagnostic-fixture.ts';
import { appUrl, test } from './workspace.ts';

async function tabTo(page: Page, control: Locator, direction: 'Tab' | 'Shift+Tab' = 'Tab') {
  await expect(control, 'The audit control must exist before keyboard traversal.').toBeVisible({ timeout: 3000 });
  for (let step = 0; step < 24; step += 1) {
    if (await control.evaluate(element => element === document.activeElement)) break;
    await page.keyboard.press(direction);
  }
  await expect(control, `The audit control must be reachable using ${direction}.`).toBeFocused({ timeout: 1000 });
}

async function readableText(root: Locator, value: string, width: number) {
  const text = root.getByText(value, { exact: true });
  await expect(text, `${width}px: retain exactly one complete stored field in the report.`).toHaveCount(1);
  await expect(text, `${width}px: stored report text must remain visible.`).toBeVisible();
  await text.scrollIntoViewIfNeeded();
  await expect(text, `${width}px: stored report text must be reachable by scrolling.`).toBeInViewport();
  expect.soft(await text.evaluate(element => ({
    horizontal: element.scrollWidth <= element.clientWidth + 1,
    vertical: element.scrollHeight <= element.clientHeight + 1,
  })), `${width}px: complete report fields must wrap without clipping or ellipsis.`).toEqual({ horizontal: true, vertical: true });
}

test('delivery reports preserve audit content and readable layout at desktop and 390px', async ({ page }, info) => {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const database = new DatabaseSync(store.path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const root = info.outputPath('layout-fixture');
  mkdirSync(root, { recursive: true });
  const prefix = `Layout-${randomUUID()}`;
  const repo = store.work.addRepo({ name: prefix, path: root, targetBranch: 'main' });
  const issue = store.create({ title: `${prefix} delivery audit`, description: 'Inspect stored report layout.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Read complete delivery audit content.'] } });
  try {
    const run = recordDiagnosticRun(store, database, { root, repoId: repo.id, requirementId: null, issueId: issue.id, status: 'completed' });
    const artifactPath = `logs/${'retained-audit-segment-'.repeat(6)}${'e'.repeat(64)}.log`;
    const evidenceText = `Retained evidence begins\n${'long-evidence-token-'.repeat(24)}\nRetained evidence ends\n`;
    mkdirSync(dirname(join(run.evidencePath, artifactPath)), { recursive: true });
    writeFileSync(join(run.evidencePath, artifactPath), evidenceText);
    const goal = `Business audit goal: ${'Keep all delivery observations readable and distinguish the current result from historical notes. '.repeat(5)}Goal reference ${'g'.repeat(160)}.`;
    const result = `Final owner result: ${'The verified source was integrated with the recorded review and retained evidence. '.repeat(5)}Result reference ${'r'.repeat(160)}.`;
    const historical = `Earlier worker observation: ${'This observation preceded the final owner decision and remains historical. '.repeat(4)}${'h'.repeat(120)}`;
    const decision = 'Preserve the existing audit section sequence.';
    const reason = `Recorded decision reason: ${'Related delivery details must remain available together during review. '.repeat(5)}`;
    const limitation = `Retained limitation: ${'External publication context must still be considered during the audit. '.repeat(5)}${'l'.repeat(160)}`;
    const review = `Independent source assessment: ${'The retained verification and integration evidence agree with the delivered source. '.repeat(5)}`;
    const receipt = `Accepted coverage assessment: ${'Existing named behavior checks remain the source of acceptance evidence. '.repeat(5)}`;
    const recovery = `Retained recovery reason: ${'An accepted checkpoint was reused before the final verified integration. '.repeat(5)}`;
    const changedPath = `src/${'long-delivery-report-directory-'.repeat(5)}/${'retained-source-name-'.repeat(5)}.tsx`;
    const checkFile = `acceptance/${'long-behavior-check-directory-'.repeat(5)}/delivery-layout.spec.ts`;
    const checkTitle = 'Retained audit behavior check';
    const branch = `codex/${'long-retained-delivery-branch-'.repeat(5)}`;
    const baseline = 'a'.repeat(40);
    const sourceHash = 'b'.repeat(64);
    const commit = 'c'.repeat(40);
    const previousRun = 'previous-audit-run-01234567-89ab-cdef-0123-456789abcdef';
    const delivery: Omit<Delivery, 'evidence'> = {
      schemaVersion: 1, runId: run.id, taskId: 'layout-audit', title: 'Retained delivery audit', goal, summary: result,
      status: 'merged', startedAt: run.startedAt, completedAt: run.completedAt!, baseline, sourceHash,
      workerObservations: [{ attempt: 1, summary: historical }], defaults: [{ decision, reason }],
      changes: [{ path: changedPath, category: 'application', status: 'modified' }],
      checks: [{ name: 'Full verification', status: 'passed' }], nodePassed: 17, browserPassed: 9, attempts: 2,
      behaviorChecks: [{ title: checkTitle, file: checkFile }],
      phases: [{ name: 'integrated-code', startedAt: run.startedAt, completedAt: run.completedAt!, durationMs: 1250, status: 'passed' }],
      resume: { fromRunId: previousRun, reused: true, reason: recovery },
      budget: { usedMs: 2500, implementationAttempts: 2, acceptanceAttempts: 1, maxAttempts: 3, totalTimeoutMs: 60000 },
      reviewReceipts: [{ purpose: 'acceptance', approved: true, summary: receipt, planHash: '1'.repeat(64), sourceHash, criteriaHash: '2'.repeat(64), contractHash: '3'.repeat(64), evidencePath: 'review.json' }],
      review: { approved: true, summary: review }, integration: { branch, before: baseline, commit }, limitations: [limitation],
      publication: { repository: 'audit/fixture', remote: 'origin', workflow: 'verify.yml', branch, baseBranch: 'main', state: 'merged', number: 12, url: 'https://github.com/audit/fixture/pull/12', ciUrl: 'https://github.com/audit/fixture/actions/runs/12', mergeCommit: 'd'.repeat(40) },
    };
    saveDelivery(run.evidencePath, delivery);
    await page.goto(appUrl(info));
    const search = page.getByLabel('Search issues', { exact: true });
    await expect(search, 'The owned issue list must expose search.').toBeVisible({ timeout: 3000 });
    await search.fill(prefix);
    const opener = page.getByRole('button', { name: `View issue ${issue.title}`, exact: true });
    const expectedHeadings = ['Delivery report', 'Business goal', 'Result', 'What changed', 'Decisions', 'Verification', 'Planned behavior checks', 'Execution timeline', 'Recovery', 'Review receipts', 'Independent agent review', 'GitHub publication', 'Automatic integration', 'Limitations and blockers'];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(opener, `${width}px: the issue audit opener must be present.`).toBeVisible({ timeout: 3000 });
      await opener.click();
      const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
      const report = dialog.getByRole('article', { name: 'Delivery report', exact: true });
      await expect(report.getByRole('heading', { name: 'Delivery report', exact: true }), 'A populated stored report must load before layout assertions.').toBeVisible();
      await expect(report.getByRole('heading'), `${width}px: retain the existing report headings and reading order.`).toHaveText(expectedHeadings);
      await expect(report.getByText('merged', { exact: true }), 'The current report status remains distinct.').toHaveCount(1);
      const history = report.locator('details').filter({ has: page.locator('summary', { hasText: /^Historical worker observations$/ }) });
      const evidence = report.locator('details').filter({ has: page.locator('summary', { hasText: /^Evidence \(1 files\)$/ }) });
      await expect(history, 'The retained historical observations disclosure must be present.').toHaveCount(1);
      await expect(evidence, 'The retained evidence disclosure must be present.').toHaveCount(1);
      await expect(history, 'Historical observations must keep their closed default.').not.toHaveAttribute('open');
      await expect(evidence, 'Evidence must keep its closed default.').not.toHaveAttribute('open');
      for (const value of [goal, result, reason, receipt, limitation, changedPath, checkFile, previousRun, commit]) await readableText(report, value, width);
      await expect(report.getByText(decision, { exact: true }), 'The recorded decision remains visible.').toBeVisible();
      await expect(report.getByText('17 Node cases · 9 browser cases · 2 implementation attempts', { exact: true }), 'Verification values remain generated from the stored numeric fields.').toBeVisible();
      await expect(report.getByText('Full verification: passed', { exact: true }), 'Check outcome remains distinct from fixture prose.').toBeVisible();
      await expect(report.getByText('Accepted checkpoint reuse: yes', { exact: false }), 'The recovery decision remains visible alongside its recorded reason.').toContainText(recovery);
      await expect(report.getByText(`approved · ${review}`, { exact: true }), 'The independent outcome must retain the full review summary.').toBeVisible();
      if (width === 1280) {
        const measures = await report.locator('p').evaluateAll(elements => elements.filter(element => element.getClientRects().length > 0).map(element => {
          const style = getComputedStyle(element);
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return { field: element.textContent!.slice(0, 60), width: element.getBoundingClientRect().width, maximum: 80 * context.measureText('0').width };
        }));
        expect(measures.length, 'Desktop width measurement must include populated report prose.').toBeGreaterThan(5);
        expect.soft(measures.filter(measure => measure.width > measure.maximum + 1), 'Desktop delivery report prose must have a comfortable reading measure of at most 80ch.').toEqual([]);
      }
      const selector = dialog.getByLabel('Select execution run', { exact: true });
      await tabTo(page, selector);
      const historySummary = history.locator('summary');
      await tabTo(page, historySummary);
      await tabTo(page, selector, 'Shift+Tab');
      await tabTo(page, historySummary);
      await page.keyboard.press('Enter');
      await expect(history, 'Keyboard activation reveals retained history.').toHaveAttribute('open', '');
      await readableText(history, historical, width);
      await expect(history.getByText("These observations precede the controller's final verification and decision.", { exact: true }), 'The application must label worker observations as historical separately from stored prose.').toBeVisible();
      await tabTo(page, evidence.locator('summary'));
      await page.keyboard.press('Enter');
      await expect(evidence, 'Keyboard activation reveals retained evidence.').toHaveAttribute('open', '');
      for (const value of [baseline, sourceHash]) await readableText(evidence, value, width);
      await readableText(evidence, artifactPath, width);
      const artifactSelector = report.getByLabel('Select evidence artifact', { exact: true });
      await tabTo(page, artifactSelector);
      await expect(artifactSelector, 'The evidence selector must be enabled before selecting retained text.').toBeEnabled();
      await artifactSelector.selectOption(artifactPath);
      const preview = report.getByRole('region', { name: 'Evidence preview', exact: true }).locator('pre');
      await expect(preview, 'The selected manifest artifact must render its complete stored text.').toHaveText(evidenceText, { useInnerText: false });
      await tabTo(page, preview);
      await expect(preview, `${width}px: keyboard users can reach the bounded evidence preview.`).toBeInViewport();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: long audit fields must not cause horizontal page overflow.`).toBe(true);
      expect.soft(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}px: long audit fields must not cause horizontal dialog overflow.`).toBe(true);
      expect.soft(await report.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}px: report content must fit its reading container.`).toBe(true);
      await page.screenshot({ path: info.outputPath(`delivery-report-layout-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(dialog, 'The audit can still be dismissed by keyboard.').toHaveCount(0);
      await expect(opener, 'Dismissing the audit restores its opener.').toBeFocused();
    }
  } finally {
    database.prepare('DELETE FROM work_runs WHERE repo_id = ?').run(repo.id);
    database.prepare('DELETE FROM jobs WHERE repo_id = ?').run(repo.id);
    store.delete(issue.id);
    database.prepare('DELETE FROM repos WHERE id = ?').run(repo.id);
    database.close();
    store.close();
  }
});
