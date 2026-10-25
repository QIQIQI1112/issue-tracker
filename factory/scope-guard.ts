import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertTestInventory } from './checkpoint.ts';
import { scoped } from './contracts.ts';
import type { Task } from './contracts.ts';
import { snapshot } from './evidence.ts';
import { git, protectedPath } from './workspace.ts';
import type { OwnerAuthorization } from './profiles.ts';

export class ScopeGuard {
  readonly baselinePaths: Set<string>;
  readonly protectedFiles: Map<string, string>;
  readonly originalChecks: Map<string, Buffer>;
  private mode: 'authoring' | 'frozen' | 'regression' = 'authoring';
  private cwd: string;
  private task: Task;
  private baseline: ReturnType<typeof snapshot>;
  private authority?: OwnerAuthorization;
  constructor(cwd: string, task: Task, baseline: ReturnType<typeof snapshot>, authority?: OwnerAuthorization) {
    this.authority = authority;
    this.cwd = cwd; this.task = task; this.baseline = baseline;
    this.baselinePaths = new Set(baseline.files.map(file => file.path));
    this.protectedFiles = new Map(baseline.files.filter(file => protectedPath(file.path, this.baselinePaths) && !this.authorized(file.path, false)).map(file => [file.path, file.hash]));
    this.originalChecks = new Map(baseline.files.filter(file => /^(tests|acceptance)\//.test(file.path)).map(file => [file.path, readFileSync(join(cwd, file.path))]));
  }
  private authorized(path: string, tests: boolean): boolean {
    return Boolean(this.authority && this.authority.scope.some(scope => scope.endsWith('/') ? path.startsWith(scope) : path === scope) && (tests ? this.authority.profile === 'acceptance_contract' : !/^(tests|acceptance)\//.test(path)));
  }
  get frozen(): boolean { return this.mode !== 'authoring'; }
  get draftingRegression(): boolean { return this.mode === 'regression'; }
  freeze(): void {
    for (const path of this.protectedFiles.keys()) if (this.authorized(path, true) && !existsSync(join(this.cwd, path))) this.protectedFiles.delete(path);
    this.mode = 'frozen';
  }
  regression(): void { if (!this.frozen) throw new Error('Regression authoring requires frozen initial checks.'); this.mode = 'regression'; }
  enforce(testOnly = false) {
    if (testOnly && !this.frozen && this.authority?.profile === 'acceptance_contract') {
      const indexed = new Set(git(this.cwd, ['ls-files', '--cached', '-z']).split('\0'));
      const retired = [...this.originalChecks.keys()].filter(path => indexed.has(path) && this.authorized(path, true) && !existsSync(join(this.cwd, path)));
      if (retired.length) git(this.cwd, ['add', '-u', '--', ...retired]);
    }
    const current = snapshot(this.cwd);
    const currentFiles = new Map(current.files.map(file => [file.path, file.hash]));
    const appended = new Set<string>();
    if (testOnly && !this.frozen) for (const [path, original] of this.originalChecks) {
      if (currentFiles.get(path) === this.protectedFiles.get(path) || !currentFiles.has(path) || !scoped(path, this.task)) continue;
      const content = readFileSync(join(this.cwd, path));
      if (content.length > original.length && content.subarray(0, original.length).equals(original)) appended.add(path);
    }
    for (const [path, hash] of this.protectedFiles) if (currentFiles.get(path) !== hash && !appended.has(path) && !(testOnly && !this.frozen && this.authorized(path, true))) throw new Error(`Protected contract file changed: ${path}`);
    if (this.frozen && !this.draftingRegression) assertTestInventory(current.files, [...this.protectedFiles].map(([path, hash]) => ({ path, hash })));
    const original = new Map(this.baseline.files.map(file => [file.path, file.hash]));
    for (const path of new Set([...original.keys(), ...currentFiles.keys()])) {
      if (original.get(path) === currentFiles.get(path)) continue;
      const testFile = /^(tests|acceptance)\//.test(path);
      const acceptedTest = this.frozen && testFile && this.protectedFiles.has(path) && currentFiles.get(path) === this.protectedFiles.get(path);
      const acceptedRetirement = this.frozen && testFile && this.originalChecks.has(path) && !this.protectedFiles.has(path) && !currentFiles.has(path) && this.authorized(path, true);
      const newDraft = testFile && !this.originalChecks.has(path) && !this.protectedFiles.has(path) && (testOnly && !this.frozen || this.draftingRegression);
      const revision = testOnly && !this.frozen && this.authorized(path, true);
      const ownerWrite = this.authorized(path, testFile);
      if (!scoped(path, this.task) || this.authority && !ownerWrite && !newDraft && !acceptedTest) throw new Error(`Change is outside the approved scope: ${path}`);
      if (protectedPath(path, this.baselinePaths) && !this.authorized(path, false) && !revision && !appended.has(path) && !acceptedTest && !acceptedRetirement) throw new Error(`Change is outside the approved scope: ${path}`);
      if (testOnly && !/^(tests|acceptance)\//.test(path)) throw new Error(`Tests phase changed implementation: ${path}`);
    }
    return current;
  }
}
