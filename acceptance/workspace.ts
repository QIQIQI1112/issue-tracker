import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import type { Issue, NewIssue } from '../src/domain.ts';
import { targetHeader, targetIdentity } from '../src/target-safety.ts';

type WorkspaceFixture = { prefix: string; create: (values: Partial<NewIssue> & { title: string }) => Promise<Issue> };
export const test = base.extend<{ workspace: WorkspaceFixture; ownedTarget: string }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, info) => {
    const { instanceId, databasePath } = info.project.metadata;
    if (typeof instanceId !== 'string' || typeof databasePath !== 'string') {
      throw new Error('UI tests require owned instanceId and databasePath metadata.');
    }
    await use({ ...extraHTTPHeaders, [targetHeader]: targetIdentity(instanceId, databasePath) });
  },
  ownedTarget: [async ({ request }, use, info) => {
    await assertOwnedTarget(request, info);
    await use(appUrl(info));
  }, { auto: true }],
  workspace: async ({ request, ownedTarget }, use, info) => {
    const prefix = `UI-${randomUUID()}`;
    const api = `${ownedTarget}/api/issues`;
    try {
      await use({ prefix, create: async (values) => {
        await assertOwnedTarget(request, info);
        const response = await request.post(api, { data: { ...values, title: `${prefix} ${values.title}` } });
        expect(response.status()).toBe(201);
        const body = await response.json() as { issue: Issue };
        return body.issue;
      } });
    } finally {
      await assertOwnedTarget(request, info);
      const response = await request.get(api);
      expect(response.status()).toBe(200);
      const body = await response.json() as { issues: Issue[] };
      for (const issue of body.issues.filter((item) => item.title.startsWith(`${prefix} `))) {
        await assertOwnedTarget(request, info);
        expect((await request.delete(`${api}/${issue.id}`)).status()).toBe(204);
      }
      const verification = await request.get(api);
      expect(verification.status()).toBe(200);
      expect((await verification.json() as { issues: Issue[] }).issues.some((item) => item.title.startsWith(`${prefix} `))).toBe(false);
    }
  },
});

if (process.env.UI_TEST_CHANNEL) test.use({ channel: process.env.UI_TEST_CHANNEL, video: 'off' });

async function assertOwnedTarget(request: APIRequestContext, info: TestInfo): Promise<void> {
  const response = await request.get(`${appUrl(info)}/api/health`);
  const health = await response.json() as { status: string; instanceId: string; databasePath: string };
  const expected = info.project.metadata;
  if (!response.ok() || health.status !== 'ok'
    || typeof expected.instanceId !== 'string' || typeof expected.databasePath !== 'string'
    || health.instanceId !== expected.instanceId || health.databasePath !== expected.databasePath) {
    throw new Error(`Owned UI target identity mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(health)}. Refusing fixture mutations or cleanup.`);
  }
}

export function appUrl(info: TestInfo): string {
  const url = info.project.use.baseURL;
  if (!url) throw new Error('UI tests require the owned Playwright baseURL.');
  return url;
}
