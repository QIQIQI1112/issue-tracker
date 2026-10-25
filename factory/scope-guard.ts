import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertTestInventory } from './checkpoint.ts';
import { scoped } from './contracts.ts';
import type { Task } from './contracts.ts';
import { snapshot } from './evidence.ts';
import { protectedPath } from './workspace.ts';

export class ScopeGuard {
  readonly baselinePaths: Set<string>;
  readonly protectedFiles: Map<string, string>;
  readonly originalChecks: Map<string, Buffer>;
  private mode: 'authoring' | 'frozen' | 'regression' = 'authoring';
  private cwd: string;
  private task: Task;
  private baseline: ReturnType<typeof snapshot>;
  constructor(cwd: string, task: Task, baseline: ReturnType<typeof snapshot>) {
    this.cwd = cwd; this.task = task; this.baseline = baseline;
    this.baselinePaths = new Set(baseline.files.map(file => file.path));
    this.protectedFiles = new Map(baseline.files.filter(file => protectedPath(file.path, this.baselinePaths)).map(file => [file.path, file.hash]));
    this.originalChecks = new Map(baseline.files.filter(file => /^(tests|acceptance)\//.test(file.path)).map(file => [file.path, readFileSync(join(cwd, file.path))]));
  }
  get frozen(): boolean { return this.mode !== 'authoring'; }
  get draftingRegression(): boolean { return this.mode === 'regression'; }
  freeze(): void { this.mode = 'frozen'; }
  regression(): void { if (!this.frozen) throw new Error('Regression authoring requires frozen initial checks.'); this.mode = 'regression'; }
  enforce(testOnly = false) {
    const current = snapshot(this.cwd);
    const currentFiles = new Map(current.files.map(file => [file.path, file.hash]));
    const appended = new Set<string>();
    if (testOnly && !this.frozen) for (const [path, original] of this.originalChecks) {
      if (currentFiles.get(path) === this.protectedFiles.get(path) || !currentFiles.has(path) || !scoped(path, this.task)) continue;
      const content = readFileSync(join(this.cwd, path));
      if (content.length > original.length && content.subarray(0, original.length).equals(original)) appended.add(path);
    }
    for (const [path, hash] of this.protectedFiles) if (currentFiles.get(path) !== hash && !appended.has(path)) throw new Error(`Protected contract file changed: ${path}`);
    if (this.frozen && !this.draftingRegression) assertTestInventory(current.files, [...this.protectedFiles].map(([path, hash]) => ({ path, hash })));
    const original = new Map(this.baseline.files.map(file => [file.path, file.hash]));
    for (const path of new Set([...original.keys(), ...currentFiles.keys()])) {
      if (original.get(path) === currentFiles.get(path)) continue;
      const acceptedExtension = this.frozen && this.originalChecks.has(path) && currentFiles.get(path) === this.protectedFiles.get(path);
      if (!scoped(path, this.task) || protectedPath(path, this.baselinePaths) && !appended.has(path) && !acceptedExtension) throw new Error(`Change is outside the approved scope: ${path}`);
      if (testOnly && !/^(tests|acceptance)\//.test(path)) throw new Error(`Tests phase changed implementation: ${path}`);
    }
    return current;
  }
}
