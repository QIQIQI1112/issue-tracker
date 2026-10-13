export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the local server. Check that it is running and try again.', { cause: error });
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status}). Please try again.`);
  }
  if (data === null) throw new Error('The local server returned an unexpected response. Please try again.');
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
