import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './errors.js';

export async function acquireWorkspaceLock(directory: string) {
  await mkdir(directory, { recursive: true });
  const canonical = await realpath(directory);
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const key = createHash('sha256').update(identity).digest('hex');
  // Kernel-held endpoints disappear with their owning process. Stale PID files
  // cannot let two writers through the read/unlink/create race.
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\tandem-${key}`
      : process.platform === 'linux'
        ? `\0tandem-${key}`
        : null;
  if (!endpoint) throw new AppError('PLATFORM_UNSUPPORTED');
  const guard = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    guard.once('error', (error) =>
      reject(
        (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? new AppError('WORKSPACE_BUSY')
          : error,
      ),
    );
    guard.listen(endpoint, () => resolve());
  });
  const releaseGuard = () => new Promise<void>((resolve) => guard.close(() => resolve()));
  const path = join(canonical, 'server.lock'),
    ownerId = randomUUID();
  let owned = false;
  try {
    try {
      let previous: any;
      try {
        previous = JSON.parse(await readFile(path, 'utf8'));
      } catch (error: any) {
        if (error.code === 'ENOENT') throw error;
        throw new AppError('LOCK_INVALID');
      }
      if (previous.mode !== 'ipc' || previous.key !== key) {
        if (!Number.isInteger(previous.pid) || previous.pid <= 0)
          throw new AppError('LOCK_INVALID');
        let alive = false;
        try {
          process.kill(previous.pid, 0);
          alive = true;
        } catch (error: any) {
          alive = error.code === 'EPERM';
        }
        if (alive) throw new AppError('WORKSPACE_BUSY');
      }
      await unlink(path);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    const file = await open(path, 'wx');
    try {
      await file.writeFile(JSON.stringify({ mode: 'ipc', key, ownerId, pid: process.pid }));
      await file.sync();
      owned = true;
    } finally {
      await file.close();
    }
  } catch (error: any) {
    await releaseGuard();
    throw error.code === 'EEXIST' ? new AppError('WORKSPACE_BUSY') : error;
  }
  let released = false;
  return {
    directory: canonical,
    async release() {
      if (released) return;
      released = true;
      try {
        if (owned) {
          const record = JSON.parse(await readFile(path, 'utf8'));
          if (record.ownerId === ownerId) await unlink(path);
        }
      } catch {
        /* Never remove a lock record replaced by another owner. */
      } finally {
        await releaseGuard();
      }
    },
  };
}
