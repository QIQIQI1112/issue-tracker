import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from './evidence.ts';
import type { VerificationContract } from './evidence.ts';

export function trustedVerifier(directory: string, contract: VerificationContract): { command: string; contractPath: string } {
  const engine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const path of ['scripts/verify.mjs', 'factory/process.ts', 'factory/ownership.ts', 'factory/evidence.ts', 'factory/node-reporter.mjs']) {
    const destination = join(directory, path); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(join(engine, path), destination);
  }
  writeJson(join(directory, 'package.json'), { type: 'module' });
  const contractPath = join(directory, 'factory/verification-contract.json');
  writeJson(contractPath, contract);
  return { command: join(directory, 'scripts/verify.mjs'), contractPath };
}
