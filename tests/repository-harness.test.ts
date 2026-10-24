import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/api.ts';
import { IssueStore } from '../src/storage.ts';
import { evidenceDirectory } from './helpers/subprocess.ts';
import { aggregateLimit, commitFiles, fixedSources, getInProcess, gitAt, harnessRepository, objects, put, sourceLimit, sourceRecord, sourceState } from './repository-harness-fixture.ts';

function fixture() {
  const root = evidenceDirectory('repository-harness');
  const store = new IssueStore(':memory:');
  const a = harnessRepository(join(root, 'alpha'), 'ALPHA');
  const b = harnessRepository(join(root, 'beta'), 'BETA');
  const first = store.work.addRepo({ name: 'Alpha enrolled repository', path: a.path, targetBranch: 'main' });
  const second = store.work.addRepo({ name: 'Beta enrolled repository', path: b.path, targetBranch: 'main' });
  const app = createApp(store, { instanceId: 'repository-harness', version: 'test' });
  const get = (id = first.id, query = '') => getInProcess(app, `/api/repos/${id}/harness${query}`);
  const ready = async (id = first.id) => {
    const response = await get(id);
    assert.equal(response.status, 200, 'Enrolled repositories must expose GET /api/repos/:id/harness.');
    return response;
  };
  return { root, store, a, b, first, second, app, get, ready };
}

test('harness API reports committed verification commands required cases documentation and provenance', async () => {
  const f = fixture();
  try {
    assert.equal((await getInProcess(f.app, '/api/repos')).status, 200, 'The in-process request fixture reaches the existing application API.');
    const response = await f.ready();
    for (const value of [f.first.name, 'main', f.a.commit, 'ALPHA-lint --check', 'ALPHA-types', 'ALPHA-build', 'ALPHA required Node case', 'ALPHA required browser case', 'ALPHA critical Node case', 'ALPHA critical browser case', 'ALPHA repository instructions', 'ALPHA verification documentation', 'ALPHA CI']) assert.ok(response.text.includes(value), `Harness must report selected committed configuration: ${value}.`);
    assert.ok(objects(response.body).some(item => item.id === f.first.id || item.repoId === f.first.id), 'Harness provenance must identify the enrolled repository ID.');
    for (const path of Object.keys(f.a.files)) sourceRecord(response.body, path);
    assert.match(response.text, /configur|not (?:run|executed)|execution.*(?:unknown|unavailable|not)/i, 'Configuration must not claim recorded execution success.');
    assert.doesNotMatch(response.text, /"(?:passed|success)"\s*:\s*true/, 'Reading configuration cannot assert a successful verification run.');
    f.store.work.configureGitHub(f.second.id, { repository: 'fixture/beta', remote: 'origin', workflow: 'specific-checks.yaml' });
    const customCommit = commitFiles(f.b.path, { '.github/workflows/specific-checks.yaml': 'name: BETA_ENROLLED_CUSTOM_CI\njobs: {}\n', '.github/workflows/verify.yml': 'name: UNENROLLED_DEFAULT_CI_DECOY\n' });
    const custom = await f.ready(f.second.id);
    sourceRecord(custom.body, '.github/workflows/specific-checks.yaml');
    assert.ok(custom.text.includes('BETA_ENROLLED_CUSTOM_CI') && custom.text.includes(customCommit), 'The validated enrolled workflow basename must be read at the same committed snapshot.');
    assert.doesNotMatch(custom.text, /UNENROLLED_DEFAULT_CI_DECOY/, 'An enrolled custom workflow must not be replaced by the default workflow.');
  } finally { f.store.close(); }
  await checkApplicationHarnessExplanations();
});

test('harness API reads the enrolled target commit instead of HEAD dirty files or another repository', async () => {
  const f = fixture();
  try {
    gitAt(f.a.path, ['checkout', '-b', 'unrelated-head']);
    commitFiles(f.a.path, { 'package.json': JSON.stringify({ scripts: { verify: 'HEAD_ONLY_SENTINEL' } }) });
    put(f.a.path, 'AGENTS.md', 'DIRTY_ONLY_SENTINEL');
    const alpha = await f.ready();
    const beta = await f.ready(f.second.id);
    assert.ok(alpha.text.includes(f.a.commit), 'Alpha provenance must resolve its enrolled main branch.');
    assert.ok(beta.text.includes(f.b.commit), 'Beta provenance must resolve its own main branch.');
    assert.ok(alpha.text.includes('ALPHA-lint --check') && beta.text.includes('BETA-lint --check'), 'Different repositories must report their own commands.');
    assert.doesNotMatch(alpha.text, /HEAD_ONLY_SENTINEL|DIRTY_ONLY_SENTINEL|BETA-lint/);
    assert.doesNotMatch(beta.text, /ALPHA-lint|HEAD_ONLY_SENTINEL|DIRTY_ONLY_SENTINEL/);
  } finally { f.store.close(); }
});

test('harness API distinguishes discovered tests named requirements and ci-critical configuration', async () => {
  const f = fixture();
  try {
    commitFiles(f.a.path, { 'factory/verification-contract.json': JSON.stringify({ schemaVersion: 1, requiredBrowserTests: f.a.full.requiredBrowserTests }) });
    const response = await f.ready();
    assert.match(response.text, /no explicit|not explicitly|discover|not (?:configured|specified|declared)/i, 'Omitted requiredNodeTests must explain that named Node requirements are unspecified or discovered.');
    assert.ok(response.text.includes('ALPHA critical Node case') && response.text.includes('ci-critical'), 'Critical CI names and profile remain distinct from full verification.');
    assert.ok(response.text.includes('ALPHA custom verifier source'), 'A custom verifier must remain inspectable as source when safe expansion is unavailable.');
    assert.doesNotMatch(response.text, /no Node tests|zero Node tests/i, 'Omitted named requirements do not imply an absence of Node tests.');
  } finally { f.store.close(); }
  await checkApplicationHarnessExplanations();
});

test('harness API rejects invalid IDs and caller-selected paths refs or profiles', async () => {
  const f = fixture();
  try {
    for (const id of ['0', '-1', 'NaN', '1.5', '9007199254740993', '1%3Bpwd']) {
      const response = await getInProcess(f.app, `/api/repos/${id}/harness`);
      assert.equal(response.status, 400, `Invalid repository ID ${id} must be rejected before reading.`);
    }
    assert.equal((await f.get(999999)).status, 404, 'Unknown enrolled repository IDs must return 404.');
    for (const query of ['?path=/etc/passwd', '?file=../../secret', '?ref=HEAD', '?commit=HEAD', '?branch=other', '?profile=ci-critical', '?path=a&path=b']) assert.equal((await f.get(f.first.id, query)).status, 400, `Caller override ${query} must be rejected.`);
  } finally { f.store.close(); }
});

test('harness API reports unavailable repositories and target refs without exposing unrelated files', async () => {
  const f = fixture();
  try {
    gitAt(f.a.path, ['checkout', '-b', 'retained']); gitAt(f.a.path, ['branch', '-D', 'main']);
    renameSync(f.b.path, join(f.root, 'moved-beta'));
    for (const id of [f.first.id, f.second.id]) {
      const response = await f.get(id);
      assert.ok([200, 409, 503].includes(response.status), 'Unavailable metadata must have an explicit safe response rather than a missing route or generic server error.');
      assert.match(response.text, /unavailable|not available|missing.*(?:ref|branch)|cannot.*read/i, 'The reason repository metadata is unavailable must be explicit.');
      assert.doesNotMatch(response.text, /fatal:|ENOENT|\/etc\/passwd|ALPHA-lint|BETA-lint/);
      assert.ok(!response.text.includes(f.root), 'Unavailable responses must not leak local filesystem roots.');
    }
  } finally { f.store.close(); }
});

test('harness API reports missing malformed unsupported and unreadable sources independently', async () => {
  const f = fixture();
  try {
    for (const path of ['package.json', 'factory/verification-contract.json', 'factory/ci-verification-contract.json']) rmSync(join(f.a.path, path));
    gitAt(f.a.path, ['add', '--all']); gitAt(f.a.path, ['commit', '-m', 'Missing supported configuration']);
    const missing = await f.ready();
    for (const path of ['package.json', 'factory/verification-contract.json', 'factory/ci-verification-contract.json']) sourceState(missing.body, path, /missing|absent|not.found/i);
    assert.doesNotMatch(missing.text, /ALPHA required Node case|ALPHA critical Node case/, 'Missing manifests must never retain stale named requirements.');
    rmSync(join(f.a.path, 'README.md'));
    commitFiles(f.a.path, { 'package.json': '{broken', 'factory/verification-contract.json': JSON.stringify({ ...f.a.full, schemaVersion: 99 }), 'factory/ci-verification-contract.json': JSON.stringify({ ...f.a.critical, profile: 'unknown-profile' }), 'AGENTS.md': Buffer.from([0xff, 0xfe, 0x00]) });
    let response = await f.ready();
    sourceState(response.body, 'README.md', /missing|absent|not.found/i);
    sourceState(response.body, 'package.json', /malformed|invalid|parse/i);
    sourceState(response.body, 'factory/verification-contract.json', /unsupported/i);
    sourceState(response.body, 'factory/ci-verification-contract.json', /unsupported/i);
    sourceState(response.body, 'AGENTS.md', /invalid|unreadable|encoding|binary/i);
    assert.ok(response.text.includes('ALPHA verification documentation'), 'One failed source must not erase valid documentation.');
    const invalidManifests = [null, [], { ...f.a.full, requiredNodeTests: 'wrong' }, { ...f.a.full, requiredBrowserTests: [{ file: '../secret', title: 'Invalid path' }] }, { ...f.a.full, requiredNodeTests: [f.a.full.requiredNodeTests[0], f.a.full.requiredNodeTests[0]] }, { ...f.a.full, requiredNodeTests: [{ file: 'tests/value.test.ts', title: '' }] }, { ...f.a.full, requiredBrowserTests: [{ file: 'value.spec.ts', title: 42 }] }];
    for (const manifest of invalidManifests) {
      commitFiles(f.a.path, { 'factory/verification-contract.json': JSON.stringify(manifest) });
      response = await f.ready();
      sourceState(response.body, 'factory/verification-contract.json', /invalid|malformed|unsupported/i);
    }
    for (const configuration of [null, [], { scripts: [] }, { scripts: { verify: 42 } }]) {
      commitFiles(f.a.path, { 'package.json': JSON.stringify(configuration) });
      response = await f.ready();
      sourceState(response.body, 'package.json', /invalid|malformed|unsupported/i);
    }
    for (const manifest of [{ ...f.a.critical, schemaVersion: 99 }, { ...f.a.critical, nodeFiles: 'tests/value.test.ts' }, { ...f.a.critical, nodeFiles: ['../outside'] }, { ...f.a.critical, requiredBrowserTests: [f.a.critical.requiredBrowserTests[0], f.a.critical.requiredBrowserTests[0]] }]) {
      commitFiles(f.a.path, { 'factory/ci-verification-contract.json': JSON.stringify(manifest) });
      response = await f.ready();
      sourceState(response.body, 'factory/ci-verification-contract.json', /invalid|malformed|unsupported/i);
    }
    const blob = gitAt(f.a.path, ['rev-parse', 'main:docs/verification.md']);
    rmSync(join(f.a.path, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
    response = await f.ready();
    sourceState(response.body, 'docs/verification.md', /error|failed|unreadable|unavailable/i);
    assert.ok(!response.text.includes(f.root), 'Source read errors must be sanitized.');
  } finally { f.store.close(); }
});

test('harness API enforces source byte aggregate and manifest entry boundaries', async () => {
  const f = fixture();
  try {
    const exact = 'é'.repeat(sourceLimit / 2);
    commitFiles(f.a.path, { 'AGENTS.md': exact });
    let response = await f.ready();
    assert.ok(JSON.stringify(sourceRecord(response.body, 'AGENTS.md')).includes(exact), 'A source at exactly 256 KiB of UTF-8 bytes must remain readable.');
    commitFiles(f.a.path, { 'AGENTS.md': exact + 'x' });
    response = await f.ready();
    sourceState(response.body, 'AGENTS.md', /oversiz|too.large|limit/i);
    const packageText = f.a.files['package.json'];
    const exactPackage = packageText + ' '.repeat(sourceLimit - Buffer.byteLength(packageText));
    commitFiles(f.a.path, { 'package.json': exactPackage });
    response = await f.ready();
    assert.ok(response.text.includes('ALPHA-lint --check'), 'A valid structured source at exactly 256 KiB must be parsed.');
    commitFiles(f.a.path, { 'package.json': exactPackage + ' ' });
    response = await f.ready();
    sourceState(response.body, 'package.json', /oversiz|too.large|limit/i);
    const cases = Array.from({ length: 999 }, (_, index) => ({ file: 'tests/value.test.ts', title: `Boundary case ${index}` }));
    commitFiles(f.a.path, { 'factory/verification-contract.json': JSON.stringify({ ...f.a.full, requiredNodeTests: cases }) });
    response = await f.ready();
    assert.ok(response.text.includes('Boundary case 998'), 'A manifest may contain exactly 1000 named Node and browser cases combined.');
    commitFiles(f.a.path, { 'factory/verification-contract.json': JSON.stringify({ ...f.a.full, requiredNodeTests: [...cases, { file: 'tests/value.test.ts', title: 'Boundary case 999' }] }) });
    response = await f.ready();
    sourceState(response.body, 'factory/verification-contract.json', /oversiz|too.many|limit/i);
    const bulk = Object.fromEntries(fixedSources.map((path, index) => [path, index < 8 ? 'x'.repeat(sourceLimit) : '']));
    assert.equal(Object.values(bulk).reduce((sum, text) => sum + Buffer.byteLength(text), 0), aggregateLimit);
    commitFiles(f.a.path, bulk);
    response = await f.ready();
    assert.doesNotMatch(response.text, /aggregate.{0,60}(?:exceed|too.large)/i, 'Exactly 2 MiB must not exceed the aggregate byte limit.');
    assert.ok(JSON.stringify(sourceRecord(response.body, 'scripts/test.mjs')).includes('x'.repeat(sourceLimit)), 'Within the aggregate bound the verifier source remains complete.');
    commitFiles(f.a.path, { [fixedSources[8]]: 'x' });
    response = await f.ready();
    assert.match(response.text, /aggregate|total.*(?:limit|large)|budget/i, 'An aggregate of 2 MiB plus one byte must be reported explicitly.');
  } finally { f.store.close(); }
  await checkRejectedHarnessSources();
  await checkAggregateHarnessExhaustion();
});

test('harness API never executes repository configuration or follows symlinks submodules and manifest paths', async () => {
  const f = fixture();
  try {
    const sentinel = join(f.root, 'EXECUTED');
    const outside = join(f.root, 'outside-secret');
    put(f.root, 'outside-secret', 'UNRELATED_EXTERNAL_SECRET');
    const command = `node -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')`)}`;
    const executable = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'executed'); export default {};`;
    commitFiles(f.a.path, { 'package.json': JSON.stringify({ scripts: { verify: command }, config: { path: outside } }), 'scripts/verify.mjs': executable, 'scripts/verify-ci.mjs': executable, 'scripts/test.mjs': executable, 'factory/verification-contract.json': JSON.stringify({ ...f.a.full, requiredNodeTests: [{ file: outside, title: 'Referenced secret' }] }), 'unlisted-secret.txt': 'UNLISTED_COMMITTED_SECRET', '.gitmodules': `[submodule "docs"]\npath = docs\nurl = file://${outside}\n` });
    rmSync(join(f.a.path, 'AGENTS.md')); symlinkSync(outside, join(f.a.path, 'AGENTS.md'));
    gitAt(f.a.path, ['add', '--all']);
    gitAt(f.a.path, ['update-index', '--add', '--cacheinfo', `160000,${f.b.commit},README.md`]);
    gitAt(f.a.path, ['commit', '-m', 'Nonregular source fixtures']);
    const response = await f.ready();
    assert.equal(existsSync(sentinel), false, 'Harness inspection must never execute package commands or configuration modules.');
    assert.doesNotMatch(response.text, /UNRELATED_EXTERNAL_SECRET|UNLISTED_COMMITTED_SECRET/);
    sourceState(response.body, 'AGENTS.md', /symlink|non.regular|unsupported|not.*regular/i);
    sourceState(response.body, 'README.md', /submodule|non.regular|unsupported|not.*regular/i);
    sourceState(response.body, 'factory/verification-contract.json', /invalid|malformed|unsupported/i);
  } finally { f.store.close(); }
});

test('successive harness reads remain bound to the requested repository and resolved commit', async () => {
  const f = fixture();
  try {
    const before = await f.ready();
    const next = commitFiles(f.a.path, { 'package.json': JSON.stringify({ scripts: { verify: 'ALPHA_NEW_COMMITTED_COMMAND' } }) });
    const [alpha, beta] = await Promise.all([f.ready(), f.ready(f.second.id)]);
    assert.ok(before.text.includes(f.a.commit) && alpha.text.includes(next), 'Every read must resolve the current enrolled target commit.');
    assert.ok(alpha.text.includes('ALPHA_NEW_COMMITTED_COMMAND'), 'A previous response must not cache stale committed commands.');
    assert.ok(beta.text.includes('BETA-lint --check') && beta.text.includes(f.b.commit), 'Concurrent reads must preserve the requested repository identity.');
    assert.doesNotMatch(beta.text, /ALPHA_NEW_COMMITTED_COMMAND/);
    assert.deepEqual(f.store.work.jobs(), [], 'Harness reads cannot enqueue execution actions.');
    assert.deepEqual(f.store.work.runs(), [], 'Harness reads cannot fabricate recorded runs.');
  } finally { f.store.close(); }
});

function applicationHarnessMetadata(body: unknown, files: Record<string, string>): string {
  const fragments = Object.values(files).flatMap(value => [value, ...value.split('\n')]).filter(value => value.trim().length > 0).sort((a, b) => b.length - a.length);
  const strings = (value: unknown): string[] => {
    if (typeof value === 'string') return [fragments.reduce((text, fragment) => text.replaceAll(fragment, ''), value)];
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    const isSource = typeof record.path === 'string' && record.path in files || typeof record.file === 'string' && record.file in files;
    return Object.entries(record).filter(([key]) => !isSource || !/^(?:content|contents|text|raw|rawText|sourceText|source|body|lines)$/.test(key)).flatMap(([, nested]) => strings(nested));
  };
  return strings(body).join('\n');
}

async function checkApplicationHarnessExplanations() {
  const f = fixture();
  try {
    const files = { ...f.a.files, 'factory/verification-contract.json': JSON.stringify({ schemaVersion: 1, requiredBrowserTests: f.a.full.requiredBrowserTests }) };
    commitFiles(f.a.path, files);
    const response = await f.ready();
    const metadata = applicationHarnessMetadata(response.body, files);
    assert.match(metadata, /configur/i, 'Application-generated metadata must identify this read as configuration, independently of raw repository source.');
    assert.match(metadata, /(?:(?:not|no |cannot|without|unknown|unavailable|unverified).{0,120}(?:execut|run\b|pass|success|evidence)|(?:execut|run\b|pass|success|evidence).{0,120}(?:not|unknown|unavailable|unverified))/i, 'Application-generated metadata must explain that configuration is not recorded execution or passing evidence.');
    assert.match(metadata, /(?:(?:no explicit|no named|not explicitly|unspecified|not (?:configured|specified|declared)|omitted|does not (?:declare|specify)).{0,140}(?:Node|requiredNodeTests)|(?:Node|requiredNodeTests).{0,140}(?:no explicit|no named|not explicitly|unspecified|not (?:configured|specified|declared)|omitted|does not (?:declare|specify)))/i, 'Application-generated metadata must explain omitted full-profile named Node requirements after all raw source prose is removed.');
    assert.match(metadata, /(?:discover|(?:does not|doesn't|cannot).{0,100}(?:mean|imply|establish).{0,100}(?:no|zero|absence)|(?:Node tests|test files).{0,100}(?:may|can|could|still))/i, 'Application metadata must distinguish omitted named requirements from an absence of Node tests.');
    assert.ok(response.text.includes('ALPHA discovers Node test files'), 'The misleading source-only explanation remains present as a separate raw-source control.');
  } finally { f.store.close(); }
}

async function checkRejectedHarnessSources() {
  const f = fixture();
  const padded = (text: string) => text + ' '.repeat(sourceLimit - Buffer.byteLength(text));
  try {
    const raw = 'REJECTED_RAW_SOURCE_SENTINEL';
    const exactRaw = raw + 'é'.repeat(Math.floor((sourceLimit - raw.length) / 2)) + ' '.repeat((sourceLimit - raw.length) % 2);
    assert.equal(Buffer.byteLength(exactRaw), sourceLimit);
    commitFiles(f.a.path, { 'AGENTS.md': exactRaw });
    assert.ok((await f.ready()).text.includes(raw), 'Exactly 256 KiB of UTF-8 source text must be returned.');
    commitFiles(f.a.path, { 'AGENTS.md': exactRaw + 'x' });
    let response = await f.ready();
    sourceState(response.body, 'AGENTS.md', /oversiz|too.large|limit/i);
    assert.ok(!response.text.includes(raw), 'An oversized text source must withhold its content, including the beginning rather than only its tail.');
    const command = 'REJECTED_PACKAGE_COMMAND_SENTINEL';
    const exactPackage = padded(JSON.stringify({ scripts: { verify: command } }));
    commitFiles(f.a.path, { 'package.json': exactPackage });
    assert.ok((await f.ready()).text.includes(command), 'An exactly bounded valid package must contribute its configured command.');
    commitFiles(f.a.path, { 'package.json': exactPackage + ' ' });
    response = await f.ready();
    sourceState(response.body, 'package.json', /oversiz|too.large|limit/i);
    assert.ok(!response.text.includes(command), 'An oversized package must contribute neither raw source nor a parsed command.');
    const manifest = { schemaVersion: 1, requiredNodeTests: [{ file: 'tests/value.test.ts', title: 'REJECTED_BYTE_NODE_SENTINEL' }], requiredBrowserTests: [{ file: 'value.spec.ts', title: 'REJECTED_BYTE_BROWSER_SENTINEL' }] };
    const exactManifest = padded(JSON.stringify(manifest));
    commitFiles(f.a.path, { 'factory/verification-contract.json': exactManifest });
    response = await f.ready();
    for (const name of ['REJECTED_BYTE_NODE_SENTINEL', 'REJECTED_BYTE_BROWSER_SENTINEL']) assert.ok(response.text.includes(name), 'An exactly bounded manifest must retain configured names.');
    commitFiles(f.a.path, { 'factory/verification-contract.json': exactManifest + ' ' });
    response = await f.ready();
    sourceState(response.body, 'factory/verification-contract.json', /oversiz|too.large|limit/i);
    assert.doesNotMatch(response.text, /REJECTED_BYTE_(?:NODE|BROWSER)_SENTINEL/, 'An oversized manifest must contribute no raw or parsed case names.');
    const cases = Array.from({ length: 999 }, (_, index) => ({ file: 'tests/value.test.ts', title: `REJECTED_ENTRY_SENTINEL ${index}` }));
    commitFiles(f.a.path, { 'factory/verification-contract.json': JSON.stringify({ ...manifest, requiredNodeTests: cases }) });
    response = await f.ready();
    assert.ok(response.text.includes('REJECTED_ENTRY_SENTINEL 998') && response.text.includes('REJECTED_BYTE_BROWSER_SENTINEL'), 'Exactly 1000 combined entries must remain valid.');
    const excessiveManifest = JSON.stringify({ ...manifest, requiredNodeTests: [...cases, { file: 'tests/value.test.ts', title: 'REJECTED_EXCESS_ENTRY_SENTINEL' }] });
    commitFiles(f.a.path, { 'factory/verification-contract.json': excessiveManifest });
    response = await f.ready();
    sourceState(response.body, 'factory/verification-contract.json', /oversiz|too.many|limit/i);
    const parsedMetadata = applicationHarnessMetadata(response.body, { 'factory/verification-contract.json': excessiveManifest });
    assert.doesNotMatch(parsedMetadata, /REJECTED_ENTRY_SENTINEL|REJECTED_EXCESS_ENTRY_SENTINEL|REJECTED_BYTE_BROWSER_SENTINEL/, 'A 1001-entry manifest must contribute no accepted cases, including its first 1000 entries.');
  } finally { f.store.close(); }
}

async function checkAggregateHarnessExhaustion() {
  const f = fixture();
  try {
    const criticalIndex = fixedSources.indexOf('factory/ci-verification-contract.json');
    const overflowIndex = Math.max(criticalIndex + 1, Math.ceil(aggregateLimit / sourceLimit));
    const overflowPath = fixedSources[overflowIndex];
    assert.ok(criticalIndex >= 0 && overflowPath, 'The aggregate fixture needs a known source after enough bounded predecessors.');
    let remaining = aggregateLimit;
    const bulk = Object.fromEntries(fixedSources.map((path, index) => {
      if (index >= overflowIndex) return [path, ''];
      let text = `AGGREGATE_ALLOWED_SOURCE_${index}`;
      if (path === 'package.json') text = JSON.stringify({ scripts: { verify: 'AGGREGATE_ALLOWED_COMMAND' } });
      if (path === 'factory/verification-contract.json') text = JSON.stringify({ schemaVersion: 1, requiredNodeTests: [{ file: 'tests/value.test.ts', title: 'AGGREGATE_ALLOWED_CASE' }], requiredBrowserTests: [] });
      const bytes = Math.min(sourceLimit, remaining);
      remaining -= bytes;
      assert.ok(Buffer.byteLength(text) <= bytes, 'Each intended source must fit before the exact aggregate boundary.');
      return [path, text + ' '.repeat(bytes - Buffer.byteLength(text))];
    }));
    assert.equal(remaining, 0);
    assert.equal(Object.values(bulk).reduce((sum, value) => sum + Buffer.byteLength(value), 0), aggregateLimit);
    commitFiles(f.a.path, bulk);
    let response = await f.ready();
    for (const text of ['AGGREGATE_ALLOWED_COMMAND', 'AGGREGATE_ALLOWED_CASE', 'AGGREGATE_ALLOWED_SOURCE_5']) assert.ok(response.text.includes(text), 'Exactly 2 MiB must retain valid commands, named cases and source content.');
    commitFiles(f.a.path, { [overflowPath]: 'x' });
    response = await f.ready();
    const oneByteOver = sourceState(response.body, overflowPath, /aggregate|limit|budget|oversiz|too.large/i);
    assert.equal(oneByteOver.content, undefined, 'Exactly 2 MiB plus one byte must withhold the first overflowing source.');
    assert.equal(oneByteOver.profile, undefined, 'A withheld source must contribute no accepted configuration profile.');
    const excess = 'AGGREGATE_WITHHELD_NODE_SENTINEL';
    commitFiles(f.a.path, { [overflowPath]: excess });
    response = await f.ready();
    assert.match(response.text, /aggregate|total.*(?:limit|large)|budget/i, 'Aggregate exhaustion needs an explicit diagnostic.');
    assert.ok(!response.text.includes(excess), 'A source beyond the aggregate allowance must supply neither raw text nor parsed metadata.');
    const withheld = sourceState(response.body, overflowPath, /aggregate|limit|budget|oversiz|too.large/i);
    assert.equal(withheld.content, undefined);
    assert.equal(withheld.profile, undefined);
  } finally { f.store.close(); }
}

test('harness API describes active code-only manifests without inventing browser execution evidence', async () => {
  const f = fixture();
  try {
    const full = { schemaVersion: 2, profile: 'code-only', requiredNodeTests: f.a.full.requiredNodeTests, requiredBrowserTests: [] };
    const critical = { schemaVersion: 2, profile: 'ci-critical', nodeFiles: f.a.critical.nodeFiles, requiredNodeTests: f.a.critical.requiredNodeTests, requiredBrowserTests: [] };
    const commit = commitFiles(f.a.path, { 'factory/verification-contract.json': JSON.stringify(full), 'factory/ci-verification-contract.json': JSON.stringify(critical) });
    const response = await f.ready();
    assert.ok(response.text.includes(commit));
    for (const path of ['factory/verification-contract.json', 'factory/ci-verification-contract.json']) {
      const source = sourceState(response.body, path, /available/i);
      assert.ok(source.profile && typeof source.profile === 'object');
      const profile = source.profile as { requiredNodeTests: unknown[]; requiredBrowserTests: unknown[] };
      assert.equal(profile.requiredNodeTests.length, 1);
      assert.deepEqual(profile.requiredBrowserTests, []);
    }
    assert.ok(response.text.includes('ALPHA required Node case') && response.text.includes('ALPHA critical Node case'));
    assert.doesNotMatch(response.text, /"(?:passed|success)"\s*:\s*true/);
  } finally { f.store.close(); }
});
