import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from './workspace.ts';
import { recordDiagnosticRun } from './diagnostic-fixture.ts';
import { IssueStore } from '../src/storage.ts';
import type { Issue } from '../src/domain.ts';

async function paint(control: Locator) {
  return control.evaluate(element => {
    const style = getComputedStyle(element);
    const transparent = style.outlineColor === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(style.outlineColor);
    return {
      outline: !transparent && !['none', 'hidden'].includes(style.outlineStyle) && parseFloat(style.outlineWidth) > 0,
      shadow: style.boxShadow,
      border: [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft].join('|'),
      background: style.backgroundColor,
      hovered: element.matches(':hover'),
      pressed: element.matches(':active'),
    };
  });
}

type Paint = Awaited<ReturnType<typeof paint>>;

async function unframed(control: Locator, message: string, resting?: Paint) {
  await expect(control, message).toBeVisible();
  await expect.poll(async () => (await paint(control)).outline, { message }).toBe(false);
  if (resting) await expect.poll(async () => (await paint(control)).shadow, { message: `${message} Focus must not add a shadow frame.` }).toBe(resting.shadow);
}

async function keyboardIndicator(control: Locator, resting: Paint) {
  await expect(control, 'The observed keyboard indicator must belong to the actually focused destination.').toBeFocused();
  await expect(control, 'The keyboard destination and its indicator must be on screen.').toBeInViewport();
  await expect.poll(async () => {
    const current = await paint(control);
    return current.outline || current.shadow !== resting.shadow || current.border !== resting.border || current.background !== resting.background;
  }, { message: 'Intentional keyboard focus must produce a visible outline or another rendered focus indicator on the focused element.' }).toBe(true);
}

async function pointerUnframed(page: Page, control: Locator, message: string, dialog?: Locator) {
  await expect(control, `${message} Observe the pointer-owned focus before intentionally moving it.`).toBeFocused();
  await unframed(control, message);
  const focusedPaint = await paint(control);
  await page.keyboard.press('Tab');
  await expect(control, 'Normal Tab navigation must move focus away before sampling the same control without focus.').not.toBeFocused();
  if (dialog) expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'The comparison Tab must remain inside the open modal.').toBe(true);
  if (focusedPaint.hovered) await control.hover();
  else await page.mouse.move(0, 0);
  const visual = ({ outline, shadow, border, background, hovered }: Paint) => ({ outline, shadow, border, background, hovered });
  await expect.poll(async () => visual(await paint(control)), {
    message: `${message} Outline, shadow, border and background must match this same unfocused control with the same hover state; native pressed metadata is diagnostic only.`,
  }).toEqual(visual(focusedPaint));
}

async function reachByTab(page: Page, control: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab', dialog?: Locator) {
  await expect(control, `The planned ${key} destination must exist before keyboard traversal.`).toBeVisible();
  await expect(control, 'The planned keyboard destination must be enabled.').toBeEnabled();
  for (let step = 0; step < 100; step++) {
    await page.keyboard.press(key);
    if (dialog) expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'Every keyboard traversal step must remain inside the open modal.').toBe(true);
    if (await control.evaluate(element => document.activeElement === element)) break;
  }
  await expect(control, `Normal ${key} traversal must reach the destination within 100 presses without programmatic focus.`).toBeFocused();
}

async function neutral(dialog: Locator, stage: string) {
  await expect(dialog, `The named modal must be visible ${stage}.`).toBeVisible();
  await expect(dialog, `Opening diagnostics must focus the named neutral modal container rather than selecting a control ${stage}.`).toBeFocused();
  await unframed(dialog, `The neutral modal container must not draw a focus frame ${stage}.`);
}

async function click(control: Locator) {
  await expect(control, 'The planned pointer target must exist before activation.').toBeVisible();
  await expect(control, 'The planned pointer target must be enabled.').toBeEnabled();
  await control.click();
}

test('issue entry and passive focus restoration stay unframed while intentional keyboard focus survives refresh', async ({ page, context, workspace }) => {
  const issues: Issue[] = [];
  for (let index = 0; index < 10; index++) issues.push(await workspace.create({ title: `Focus scrolling record ${index}` }));
  let generation = 0;
  let registryReads = 0;
  let pending: { entered: boolean; failure: boolean; wait: Promise<void>; release: () => void } | null = null;
  await page.route('**/api/workbench', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.jobs = [{ id: -1, status: ['queued', 'completed', 'blocked'][generation] }];
    registryReads++;
    await route.fulfill({ response, json: data });
  });
  await page.route('**/api/issues', async route => {
    const active = pending;
    if (active) {
      active.entered = true;
      await active.wait;
      if (active.failure) return route.fulfill({ status: 503, json: { error: 'Owned intentional-focus refresh failure' } });
    }
    const response = await route.fetch();
    const data = await response.json();
    data.issues = data.issues.filter((issue: { id: number }) => issues.some(owned => owned.id === issue.id));
    await route.fulfill({ response, json: data });
  });
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const region = page.getByRole('region', { name: 'Issue list', exact: true });
    const list = region.getByRole('list', { name: 'Issues on this page', exact: true });
    await expect(region, 'The initial issue collection must settle before focus observations.').toHaveAttribute('aria-busy', 'false');
    await expect(list, 'Fresh issue entry must render the named scrolling region.').toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(10);
    expect(await page.evaluate(() => document.activeElement?.matches('button, input, select, textarea, a[href], [role="button"], [role="combobox"]') ?? false), 'Fresh issue-page entry must not automatically select an interactive control.').toBe(false);
    await unframed(list, 'Fresh issue-page entry must not display an unsolicited scrolling-region focus frame.');
    const resting = await paint(list);
    await expect(list, 'The passive restoration destination must exist before restoring focus without keyboard input.').toBeVisible();
    await list.focus();
    await expect(list, 'Passive browser-style restoration must preserve the scrolling-region focus owner.').toBeFocused();
    await unframed(list, 'Restoring scroller focus without Tab input must stay unframed.', resting);
    const otherTab = await context.newPage();
    try { await otherTab.bringToFront(); } finally { await otherTab.close(); }
    await page.bringToFront();
    await expect(list, 'Returning to the issue window must preserve restored focus ownership.').toBeFocused();
    await unframed(list, 'Passive window re-entry must not enable keyboard-only scroller decoration.', resting);
    await reachByTab(page, page.getByLabel('Sort issues', { exact: true }), 'Shift+Tab');
    await reachByTab(page, list);
    await keyboardIndicator(list, resting);
    const before = await list.evaluate(element => element.scrollTop);
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight), 'The keyboard-scrolling fixture must overflow its bounded viewport.').toBe(true);
    await page.keyboard.press('PageDown');
    await expect.poll(() => list.evaluate(element => element.scrollTop), { message: 'PageDown on the keyboard-focused issue scroller must scroll issue rows.' }).toBeGreaterThan(before);
    await expect.poll(() => registryReads, { message: 'An initial registry snapshot must precede controlled background changes.' }).toBeGreaterThan(0);
    const handle = await list.elementHandle();
    expect(handle, 'The focused scrolling region must have a live identity before refresh.').not.toBeNull();
    for (const failure of [false, true]) {
      let release = () => {};
      const wait = new Promise<void>(resolve => { release = resolve; });
      const active = { entered: false, failure, wait, release };
      pending = active;
      generation++;
      await expect.poll(() => active.entered, { timeout: 10000, message: 'The registry change must cause an owned issue refresh while keyboard focus is active.' }).toBe(true);
      await expect(region, 'The held refresh must expose pending state without replacing the issue list.').toHaveAttribute('aria-busy', 'true');
      expect(await handle!.evaluate(element => element.isConnected && document.activeElement === element), 'Pending refresh must preserve the exact user-focused scrolling element.').toBe(true);
      await keyboardIndicator(list, resting);
      active.release();
      await expect(region, 'The controlled refresh must settle before checking preserved focus.').toHaveAttribute('aria-busy', 'false');
      pending = null;
      if (failure) await expect(region.getByRole('alert'), 'The failed refresh must be observed as an application-generated error.').toHaveText('Owned intentional-focus refresh failure');
      expect(await handle!.evaluate(element => element.isConnected && document.activeElement === element), 'Successful and failed refresh must preserve the original keyboard focus owner.').toBe(true);
      await keyboardIndicator(list, resting);
    }
  } finally {
    pending?.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('pointer diagnostics open on a named neutral container without focusing controls or drawing a frame', async ({ page, workspace }) => {
  const issue = await workspace.create({ title: 'Pointer neutral diagnostic focus', description: 'Hydrated pointer inspection details.' });
  await workspace.create({ title: 'Different opener must not receive returned focus' });
  await page.goto('/');
  for (const kind of ['Inspect', 'View']) {
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/issues/${issue.id}`, async route => { await held; await route.continue(); });
    try {
      const opener = page.getByRole('button', { name: `${kind} issue ${issue.title}`, exact: true });
      await expect(opener, 'Both title and identifier diagnostic openers must remain available.').toBeVisible();
      const openerResting = await paint(opener);
      if (kind === 'View') {
        await reachByTab(page, opener);
        await keyboardIndicator(opener, openerResting);
      }
      await click(opener);
      const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
      await expect(dialog.getByRole('status'), 'The initial focus assertion must occur while issue details are still pending.').toHaveText('Loading issue…');
      await neutral(dialog, 'before detail hydration');
      const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
      await unframed(close, 'Pointer opening must not draw an unsolicited Close-button frame while details are pending.');
      const initialFrame = await paint(dialog);
      release();
      await expect(dialog.getByRole('heading', { name: issue.title, exact: true }), 'Detail hydration must finish before the second neutral-focus observation.').toBeVisible();
      await neutral(dialog, 'after detail hydration');
      await unframed(close, 'Detail hydration must not add an unsolicited Close-button frame.');
      await expect(close, 'Close must remain available for intentional navigation.').toBeVisible();
      await reachByTab(page, close, 'Tab', dialog);
      await unframed(dialog, 'The neutral container must have the same frame after focus moves to a control.', initialFrame);
      await click(close);
      await expect(dialog, 'Pointer dismissal must remove the modal.').toHaveCount(0);
      await expect(opener, 'Pointer dismissal must restore the exact title or identifier opener, not another issue or its sibling control.').toBeFocused();
      await pointerUnframed(page, opener, 'Pointer opening and dismissal must clear earlier keyboard-only focus decoration.');
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});

test('keyboard diagnostics start neutrally and preserve visible bidirectional focus until pointer input', async ({ page }, info) => {
  const store = new IssueStore(info.project.metadata.databasePath as string);
  const database = new DatabaseSync(store.path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const root = info.outputPath('focus-diagnostic-evidence');
  mkdirSync(root, { recursive: true });
  const repo = store.work.addRepo({ name: `Focus-${randomUUID()}`, path: root, targetBranch: 'main' });
  const issue = store.create({ title: `Keyboard neutral focus ${randomUUID()}`, description: 'Owned keyboard focus inspection.', status: 'open', priority: 'medium', labels: [], work: { repoId: repo.id, requirementId: null, dependsOn: [], acceptance: ['Intentional keyboard inspection.'] } });
  const runs = [recordDiagnosticRun(store, database, { root, repoId: repo.id, requirementId: null, issueId: issue.id, status: 'blocked' }), recordDiagnosticRun(store, database, { root, repoId: repo.id, requirementId: null, issueId: issue.id, status: 'completed' })];
  try {
    await page.goto('/');
    const opener = page.getByRole('button', { name: `Inspect issue ${issue.title}`, exact: true });
    await expect(opener, 'The keyboard diagnostic opener must be rendered before traversal.').toBeVisible();
    const openerResting = await paint(opener);
    await reachByTab(page, opener);
    await keyboardIndicator(opener, openerResting);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: `Issue #${issue.id}`, exact: true });
    await neutral(dialog, 'after keyboard opening');
    const neutralFrame = await paint(dialog);
    const selector = dialog.getByRole('combobox', { name: 'Select execution run', exact: true });
    await expect(selector, 'Hydrated diagnostics must provide a second real keyboard destination.').toBeVisible();
    await expect(selector.locator('option'), 'The run selector must expose both distinct owned diagnostic runs.').toHaveCount(2);
    expect(await selector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), 'The keyboard fixture must expose the exact owned run IDs.').toEqual(expect.arrayContaining(runs.map(run => run.id)));
    await neutral(dialog, 'after keyboard-opened detail hydration');
    const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
    await expect(close, 'The modal close control must exist before keyboard traversal.').toBeVisible();
    const closeResting = await paint(close);
    const selectorResting = await paint(selector);
    const stops = dialog.getByRole('button').or(dialog.getByRole('combobox')).or(dialog.getByRole('link')).or(dialog.getByRole('textbox'));
    const first = stops.first();
    const last = stops.last();
    await expect(first, 'The modal must expose a first keyboard destination.').toBeVisible();
    await expect(last, 'The modal must expose a last keyboard destination.').toBeVisible();
    const firstResting = await paint(first);
    const lastResting = await paint(last);
    await page.keyboard.press('Tab');
    await keyboardIndicator(first, firstResting);
    await unframed(dialog, 'Initial neutral focus must not add an outline or shadow compared with the unfocused modal.', neutralFrame);
    await page.keyboard.press('Shift+Tab');
    await expect(last, 'Shift+Tab at the first modal control must wrap to the last modal control.').toBeFocused();
    await keyboardIndicator(last, lastResting);
    await page.keyboard.press('Tab');
    await expect(first, 'Tab at the last modal control must wrap to the first modal control.').toBeFocused();
    await keyboardIndicator(first, firstResting);
    await reachByTab(page, selector, 'Tab', dialog);
    await keyboardIndicator(selector, selectorResting);
    await reachByTab(page, close, 'Shift+Tab', dialog);
    await keyboardIndicator(close, closeResting);
    await page.keyboard.press('Escape');
    await expect(dialog, 'Escape must dismiss keyboard-opened diagnostics.').toHaveCount(0);
    await expect(opener, 'Escape must return focus to the exact original keyboard opener.').toBeFocused();
    await keyboardIndicator(opener, openerResting);
    await page.keyboard.press('Enter');
    await neutral(dialog, 'when reopened from the restored keyboard opener');
    await expect(selector, 'Reopened diagnostics must hydrate a second control before the held-pointer comparison uses Tab.').toBeVisible();
    await reachByTab(page, close, 'Tab', dialog);
    await keyboardIndicator(close, closeResting);
    await expect(close, 'The pointer transition target must exist before pressing it.').toBeVisible();
    const box = await close.boundingBox();
    expect(box, 'The focused Close control must have a pointer hit target.').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    try {
      await expect(close, 'Pointer input must clear keyboard decoration without forcibly blurring the user-owned control.').toBeFocused();
      await pointerUnframed(page, close, 'Pointer input on the keyboard-focused control must remove its keyboard-only focus frame.', dialog);
      const heading = dialog.getByRole('heading', { name: `Issue #${issue.id}`, exact: true });
      await expect(heading, 'The neutral release target must exist before ending the comparison press away from Close.').toBeVisible();
      await heading.hover();
    } finally { await page.mouse.up(); }
    await expect(dialog, 'Releasing the comparison press away from Close must leave the modal open for pointer activation.').toBeVisible();
    await click(close);
    await expect(dialog, 'Activating Close must dismiss the modal.').toHaveCount(0);
    await expect(opener, 'Close activation must restore the exact original opener.').toBeFocused();
    await pointerUnframed(page, opener, 'Pointer dismissal must leave the returned opener free of keyboard-only focus frames.');
  } finally {
    database.close();
    store.close();
  }
});
