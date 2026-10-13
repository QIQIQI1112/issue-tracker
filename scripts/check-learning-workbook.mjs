import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

const directory = resolve('.runs', `workbook-${randomUUID()}`);
mkdirSync(directory, { recursive: true });
const summary = { status: 'running', checks: [], directory };
const server = createServer((_request, response) => {
  try {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(readFileSync(resolve('docs/learning-workbook.html')));
  } catch {
    response.writeHead(404).end('The learning workbook has not been created.');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const address = server.address();
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, operation) => {
  await operation();
  summary.checks.push({ name, status: 'passed' });
  console.log(`Passed: ${name}`);
};
try {
  await check('the workbook opens with eight assignments', async () => {
    const response = await page.goto(`http://127.0.0.1:${address.port}`);
    assert.equal(response.status(), 200, 'Workbook must open successfully before a learner can answer.');
    assert.equal(await page.locator('[data-assignment]').count(), 8);
  });
  const answer = 'My evidence: title is trimmed. <script>window.answerWasExecuted = true;</script>';
  await check('answers and readiness survive a browser reload', async () => {
    await page.locator('[data-answer="a1-system"]').fill(answer);
    await page.locator('[data-ready="a1"]').check();
    await page.reload();
    assert.equal(await page.locator('[data-answer="a1-system"]').inputValue(), answer);
    assert.equal(await page.locator('[data-ready="a1"]').isChecked(), true);
    assert.equal(await page.evaluate(() => window.answerWasExecuted), undefined);
  });
  let portablePath;
  await check('an answered HTML copy restores answers in a fresh browser context', async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save answered HTML', exact: true }).click();
    const download = await pending;
    portablePath = resolve(directory, download.suggestedFilename());
    await download.saveAs(portablePath);
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.goto(pathToFileURL(portablePath).href);
    assert.equal(await freshPage.locator('[data-answer="a1-system"]').inputValue(), answer);
    assert.equal(await freshPage.locator('[data-ready="a1"]').isChecked(), true);
    assert.equal(await freshPage.evaluate(() => window.answerWasExecuted), undefined);
    await fresh.close();
  });
  let backupPath;
  await check('the JSON backup restores answers and rejects an invalid backup atomically', async () => {
    await page.getByText('Backup and restore', { exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON backup', exact: true }).click();
    const download = await pending;
    backupPath = resolve(directory, download.suggestedFilename());
    await download.saveAs(backupPath);
    await page.locator('[data-answer="a1-system"]').fill('A different draft');
    await page.locator('#import-file').setInputFiles(backupPath);
    await page.waitForFunction(() => document.querySelector('[data-answer="a1-system"]').value.startsWith('My evidence:'));
    assert.equal(await page.locator('[data-answer="a1-system"]').inputValue(), answer);
    const invalid = resolve(directory, 'invalid-backup.json');
    writeFileSync(invalid, JSON.stringify({ workbookId: 'other-workbook', answers: { 'a1-system': 'Overwrite' } }));
    await page.locator('#import-file').setInputFiles(invalid);
    await page.waitForFunction(() => document.getElementById('save-status').textContent.startsWith('Import failed:'));
    assert.equal(await page.locator('[data-answer="a1-system"]').inputValue(), answer);
  });
  await check('the review export contains the prompt and the exact answer', async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export answers for review', exact: true }).click();
    const download = await pending;
    const path = resolve(directory, download.suggestedFilename());
    await download.saveAs(path);
    const markdown = readFileSync(path, 'utf8');
    assert.ok(markdown.includes(answer));
    assert.ok(markdown.includes('What system do you have today?'));
  });
  await check('assignment navigation and the phone layout remain usable', async () => {
    await page.getByRole('button', { name: '08 Build one bounded loop', exact: true }).click();
    assert.equal(await page.locator('[data-assignment="a8"]').isVisible(), true);
    await page.getByRole('button', { name: '01 Map the system', exact: true }).click();
    await page.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(directory, 'phone.png'), fullPage: true });
    assert.deepEqual(errors, []);
  });
  summary.status = 'passed';
} catch (error) {
  summary.status = 'failed';
  summary.error = error.message;
  await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Evidence: ${directory}/summary.json`);
}
