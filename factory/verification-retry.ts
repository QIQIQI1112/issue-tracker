import type { Verification } from './controller.ts';
import { classifyVerificationFailure } from './optimization.ts';

export async function verifyWithRecovery<T extends Verification>(options: { execute: (attempt: number) => Promise<T>; identity: () => string; budget: { consumeInfrastructureRetry: () => number }; record?: (attempt: number, verification: T) => void }): Promise<{ verification: T; attempts: T[]; retries: number }> {
  const identity = options.identity();
  const attempts: T[] = [];
  for (let number = 1; ; number += 1) {
    if (options.identity() !== identity) throw new Error('Verification source, environment or contract identity changed.');
    const verification = await options.execute(number);
    attempts.push(verification);
    options.record?.(number, verification);
    if (options.identity() !== identity) throw new Error('Verification source, environment or contract identity changed.');
    if (number === 2 || !classifyVerificationFailure(verification).retryable) return { verification, attempts, retries: number - 1 };
    options.budget.consumeInfrastructureRetry();
  }
}
