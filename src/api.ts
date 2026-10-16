import type { ApiError } from '../shared/types';

export class RequestError extends Error {
  constructor(
    public code: string,
    public details = '',
  ) {
    super(code);
  }
}
let token = '';
let bootstrap: Promise<void> | undefined;
async function connect() {
  if (!bootstrap)
    bootstrap = fetch('/api/bootstrap', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      .then(async (response) => {
        if (!response.ok) throw new RequestError('NETWORK');
        token = (await response.json()).token;
      })
      .finally(() => {
        bootstrap = undefined;
      });
  await bootstrap;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  retry = true,
): Promise<T> {
  try {
    if (!token) await connect();
    const response = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      headers: {
        'x-tandem-token': token,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (response.status === 403 && data.code === 'FORBIDDEN' && retry) {
      await connect();
      return api(path, options, false);
    }
    if (!response.ok)
      throw new RequestError((data as ApiError).code || 'INTERNAL_ERROR', data.details);
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('NETWORK');
  }
}

export async function download(name: string, text: string, type = 'text/plain;charset=utf-8') {
  if (window.tandem) return window.tandem.saveFile({ name, content: text });
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function copyText(text: string) {
  if (window.tandem) return window.tandem.copyText(text);
  return navigator.clipboard.writeText(text);
}
