const controlPaths = new Set(['src/workflow-store.ts', 'src/workflow.ts', 'src/submission.ts', 'src/evidence-files.ts', 'src/target-safety.ts', 'src/instance.ts', 'src/repository.ts']);

export function controlPlanePath(path: string): boolean {
  return controlPaths.has(path) || path.startsWith('.github/');
}
