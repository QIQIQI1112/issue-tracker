export type HarnessCase = { file: string; title: string };
export type HarnessProfile = { name: 'full' | 'ci-critical'; requiredNodeTests: HarnessCase[]; requiredBrowserTests: HarnessCase[]; nodeFiles?: string[]; explanation: string };
export type HarnessSource = { path: string; commit: string; status: 'available' | 'missing' | 'malformed' | 'unsupported' | 'oversized' | 'unreadable'; message: string; bytes?: number; blob?: string; content?: string; commands?: { name: string; command: string; category: string }[]; profile?: HarnessProfile };
export type RepositoryHarness = { repository: { id: number; name: string; targetBranch: string }; status: 'available' | 'unavailable'; commit?: string; message: string; sources: HarnessSource[] };

const categories: Record<string, string> = { verify: 'Full verification entry point', 'verify:ci': 'CI verification entry point', lint: 'Lint', typecheck: 'Type checking', test: 'Node tests', build: 'Build', 'test:e2e': 'Browser acceptance' };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed configuration: expected an object.');
  return value as Record<string, unknown>;
}

function relativePath(value: unknown, node = false): value is string {
  return typeof value === 'string' && value.length <= 500 && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..') && (node ? /^tests\/.+\.test\.[cm]?[jt]sx?$/.test(value) : /\.spec\.[cm]?[jt]sx?$/.test(value));
}

function cases(value: unknown, node: boolean): HarnessCase[] {
  if (!Array.isArray(value)) throw new Error('Malformed configuration: required cases must be arrays.');
  const seen = new Set<string>();
  return value.map(item => {
    const entry = object(item);
    if (!relativePath(entry.file, node) || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 2000 || [...entry.title].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Malformed configuration: invalid case identity.');
    const key = JSON.stringify([entry.file, entry.title]);
    if (seen.has(key)) throw new Error('Malformed configuration: duplicate case identity.');
    seen.add(key);
    return { file: entry.file, title: entry.title };
  });
}

export function describeHarnessSource(source: HarnessSource): HarnessSource {
  if (source.content === undefined) return source;
  const isPackage = source.path === 'package.json';
  const isFull = source.path === 'factory/verification-contract.json';
  const isCritical = source.path === 'factory/ci-verification-contract.json';
  if (!isPackage && !isFull && !isCritical) return source;
  try {
    const value = object(JSON.parse(source.content));
    if (isPackage) {
      const scripts = value.scripts === undefined ? {} : object(value.scripts);
      if (Object.values(scripts).some(command => typeof command !== 'string')) throw new Error('Malformed configuration: package script commands must be strings.');
      return { ...source, commands: Object.entries(scripts).map(([name, command]) => ({ name, command: command as string, category: Object.hasOwn(categories, name) ? categories[name] : 'Package script' })) };
    }
    if (value.schemaVersion !== 1 || (isFull ? value.profile !== undefined && value.profile !== 'full' : value.profile !== 'ci-critical')) return { ...source, content: undefined, status: 'unsupported', message: 'Unsupported manifest schema or profile; no requirements have been inferred.' };
    if (!Array.isArray(value.requiredBrowserTests) || (value.requiredNodeTests !== undefined && !Array.isArray(value.requiredNodeTests)) || (isCritical && !Array.isArray(value.requiredNodeTests))) throw new Error('Malformed configuration: required cases must be arrays.');
    const nodes = value.requiredNodeTests as unknown[] | undefined;
    if ((nodes?.length ?? 0) + value.requiredBrowserTests.length > 1000) return { ...source, content: undefined, status: 'oversized', message: 'Manifest exceeds the limit of 1000 combined named cases.' };
    let nodeFiles: string[] | undefined;
    if (isCritical || value.nodeFiles !== undefined) {
      if (!Array.isArray(value.nodeFiles) || value.nodeFiles.length > 1000 || !value.nodeFiles.every(file => relativePath(file, true)) || new Set(value.nodeFiles).size !== value.nodeFiles.length) throw new Error('Malformed configuration: invalid Node file selection.');
      nodeFiles = value.nodeFiles as string[];
    }
    return { ...source, profile: { name: isFull ? 'full' : 'ci-critical', requiredNodeTests: cases(nodes ?? [], true), requiredBrowserTests: cases(value.requiredBrowserTests, false), ...(nodeFiles ? { nodeFiles } : {}), explanation: nodes === undefined ? 'No explicit named Node requirements are configured. Node test files may still be discovered by the runner; omitted names do not establish an absence of tests.' : 'These are configured named requirements, not recorded execution results. Runner source determines additional discovery and selection.' } };
  } catch {
    return { ...source, content: undefined, status: 'malformed', message: 'Malformed configuration: invalid JSON, field types or case identities. No commands or requirements were accepted from this source.' };
  }
}
