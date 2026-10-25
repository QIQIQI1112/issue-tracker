import assert from 'node:assert/strict';
import { act, createElement, useEffect } from 'react';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { Issues } from '../src/ui/features/issues/Issues.tsx';
import { useIssueCollection } from '../src/ui/shared/useIssueCollection.ts';
import type { Issue } from '../src/domain.ts';
import type { Job, Workbench, WorkRun } from '../src/workflow.ts';

export const now = '2026-10-20T00:00:00.000Z';
export const repo = { id: 1, name: 'Dropdown fixture', path: '/disposable/dropdown', targetBranch: 'main', createdAt: now };
export const requirement = { id: 1, repoId: 1, title: 'Scoped goal', goal: 'Preserve inspection', status: 'running' as const, createdAt: now, updatedAt: now };
export function issue(id = 37, changes: Partial<Issue> = {}): Issue {
  return { id, title: `Neutral ${id}`, description: '', status: 'open', priority: 'medium', labels: ['alpha', 'beta'], createdAt: now, updatedAt: now, work: { repoId: 1, requirementId: 1, dependsOn: [], acceptance: ['Inspect evidence'] }, ...changes };
}
export function run(id: number, issueId: number | null = 37, changes: Partial<WorkRun> = {}): WorkRun {
  return { id: `run-${id}`, jobId: id, repoId: 1, requirementId: 1, issueId, status: 'passed', evidencePath: `/disposable/dropdown/${id}`, reason: null, startedAt: now, completedAt: now, ...changes };
}
export function job(id: number, kind: Job['kind'] = 'issue', issueId: number | null = 37): Job {
  return { id, kind, issueId, repoId: 1, requirementId: 1, status: 'completed', payload: '{}', runId: `run-${id}`, reason: null, createdAt: now, updatedAt: now };
}
export function workbench(): Workbench {
  return { repos: [repo], requirements: [requirement], jobs: [job(1), job(2), job(3, 'plan_review', null), job(4, 'requirement_verify', null), { ...job(9, 'decompose', null), repoId: 2 }], runs: [run(1), run(2, 37, { status: 'merged' }), run(3, null), run(4, null), run(9, null, { repoId: 2 })] };
}
export function IssueFixture({ records = [issue()], labelFilter, onLabelChange }: { records?: Issue[]; labelFilter?: string; onLabelChange?: (value: string) => void }) {
  const collection = useIssueCollection(records, '1');
  useEffect(() => { if (labelFilter !== undefined) collection.changeLabel(labelFilter); }, [labelFilter]);
  return createElement(Issues, { collection: { ...collection, changeLabel: value => { onLabelChange?.(value); collection.changeLabel(value); } }, issues: records, loading: false, loadError: null, retryIssues: () => {}, resetFilters: collection.resetFilters, onIssue: () => {} });
}

export class Fixture {
  readonly dom = new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>', { url: 'http://localhost/' });
  readonly document = this.dom.window.document;
  readonly root = this.document.getElementById('test-root')!;
  rect = { left: 282, right: 382, top: 530, bottom: 562, width: 100, height: 32, x: 282, y: 530 };
  viewport = { width: 390, height: 600 };
  readonly intervals = new Map<number, () => void>();
  readonly requests: string[] = [];
  response: (url: string) => unknown = url => url.startsWith('/api/issues/') ? { issue: issue(), runs: [run(1), run(2), run(7, 99), run(8, 37, { repoId: 2 })] } : { run: workbench().runs.find(value => url.endsWith(value.id)) ?? run(1), delivery: null };
  private renderer?: Root;
  private restores: (() => void)[] = [];
  constructor() {
    const replace = (key: string, value: unknown) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      this.restores.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
    };
    const window = this.dom.window;
    replace('window', window);
    replace('document', this.document);
    replace('navigator', window.navigator);
    replace('HTMLElement', window.HTMLElement);
    replace('Node', window.Node);
    replace('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(window, 'innerWidth', { value: this.viewport.width });
    Object.defineProperty(window, 'innerHeight', { value: this.viewport.height });
    window.HTMLElement.prototype.getBoundingClientRect = () => new window.DOMRect(this.rect.left, this.rect.top, this.rect.width, this.rect.height);
    Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', { value: function (this: HTMLElement) { return this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]; } });
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    let intervalId = 0;
    replace('setInterval', (callback: () => void) => { const id = ++intervalId; this.intervals.set(id, callback); return id; });
    replace('clearInterval', (id: number) => this.intervals.delete(id));
    replace('fetch', async (url: string) => { this.requests.push(String(url)); const data = this.response(String(url)); return typeof data === 'string' ? new Response(data) : Response.json(data); });
  }
  all() { return [...this.root.querySelectorAll<HTMLElement>('*')]; }
  named(name: string, role?: string) { return this.all().find(node => node.getAttribute('aria-label') === name && (!role || node.getAttribute('role') === role)); }
  combobox(name: string) {
    const node = this.named(name, 'combobox');
    assert.ok(node?.matches('button'), `${name} must expose the production custom named combobox trigger.`);
    return node as HTMLButtonElement;
  }
  options() { return [...this.root.querySelectorAll<HTMLElement>('[role="option"]')]; }
  panel() { return this.root.querySelector<HTMLElement>('[role="listbox"]:not([hidden])') ?? undefined; }
  active(trigger: HTMLElement) { return this.document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '') ?? undefined; }
  async mount(input: ReactNode) {
    await act(async () => {
      if (!this.renderer) {
        const { createRoot } = await import('react-dom/client');
        this.renderer = createRoot(this.root);
      }
      this.renderer.render(input);
    });
  }
  async click(node: HTMLElement) { await act(async () => { node.focus(); node.click(); }); }
  async focus(node: HTMLElement) { await act(async () => { node.focus(); }); }
  async cancel(node: HTMLDialogElement) {
    const event = new this.dom.window.Event('cancel', { cancelable: true });
    await act(async () => { node.dispatchEvent(event); });
    return event;
  }
  async pointerDown(node: HTMLElement) {
    const event = new this.dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => { node.dispatchEvent(event); });
    return event;
  }
  async key(node: HTMLElement, key: string, shiftKey = false) {
    const event = new this.dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    await act(async () => { node.dispatchEvent(event); });
    return event;
  }
  async settle() { await act(async () => { await new Promise<void>(resolve => setImmediate(resolve)); }); }
  async refresh() { await act(async () => { for (const callback of this.intervals.values()) callback(); await new Promise<void>(resolve => setImmediate(resolve)); }); }
  async dispose() {
    try { await act(async () => { this.renderer?.unmount(); }); }
    finally { this.dom.window.close(); this.restores.reverse().forEach(restore => restore()); }
  }
}

export async function open(fixture: Fixture, name: string) {
  const trigger = fixture.combobox(name);
  await fixture.click(trigger);
  assert.ok(fixture.panel(), `${name} must open an actual custom listbox on deliberate activation.`);
  return trigger;
}
export async function choose(fixture: Fixture, name: string, label: string) {
  const trigger = await open(fixture, name);
  const option = fixture.options().find(node => node.textContent?.trim() === label);
  assert.ok(option, `${name} must expose the current option ${label}.`);
  await fixture.click(option);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'Committing a custom option closes its panel.');
  return trigger;
}
