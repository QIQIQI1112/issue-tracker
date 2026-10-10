// Optional conditional-write identity, not an authentication credential.
export const targetHeader = 'x-issue-tracker-target';

export function targetIdentity(instanceId: string, databasePath: string): string {
  return encodeURIComponent(JSON.stringify([instanceId, databasePath]));
}
