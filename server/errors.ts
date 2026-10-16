export class AppError extends Error {
  constructor(
    public code: string,
    public details = '',
    public status = 400,
  ) {
    super(code);
  }
}

export function describeError(error: unknown) {
  const value = error as { code?: string; details?: string; type?: string; status?: number };
  if (error instanceof AppError)
    return { code: error.code, details: error.details, status: error.status };
  if (value.code === 'ENOSPC') return { code: 'DISK_FULL', status: 507 };
  if (['EACCES', 'EPERM', 'EROFS'].includes(value.code || ''))
    return { code: 'PERMISSION_DENIED', status: 403 };
  if (value.type === 'entity.too.large') return { code: 'PAYLOAD_TOO_LARGE', status: 413 };
  if (value.type === 'entity.parse.failed') return { code: 'VALIDATION', status: 400 };
  return { code: 'INTERNAL_ERROR', status: 500 };
}
