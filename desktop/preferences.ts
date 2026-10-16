import { mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite } from '../server/atomic-file';
import { AppError } from '../server/errors';

export const preferenceSchema = z.object({
  locale: z.enum(['zh-CN', 'en']).optional(),
  selectedTaskId: z.string().uuid().optional(),
  dataDirectory: z.string().optional(),
  bounds: z
    .object({
      width: z.number().min(800).max(8000),
      height: z.number().min(600).max(5000),
      x: z.number().optional(),
      y: z.number().optional(),
      maximized: z.boolean().optional(),
    })
    .optional(),
});
export type Preferences = z.infer<typeof preferenceSchema>;

export class PreferenceStore {
  private value: Preferences = {};
  private initialized = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.value = preferenceSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'preferences.json'), 'utf8')),
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw new AppError('PREFERENCES_INVALID');
      try {
        await access(join(this.directory, 'preferences.backup.json'));
        throw new AppError('PREFERENCES_INVALID');
      } catch (backup: any) {
        if (backup.code !== 'ENOENT') throw backup;
      }
    }
    this.initialized = true;
    return this.snapshot();
  }
  snapshot() {
    return structuredClone(this.value);
  }
  async save(patch: Partial<Preferences>) {
    const result = this.tail.then(async () => {
      if (!this.initialized) throw new AppError('PREFERENCES_INVALID');
      const next = preferenceSchema.parse({ ...this.value, ...patch });
      if (JSON.stringify(next) === JSON.stringify(this.value)) return this.snapshot();
      await atomicWrite(
        join(this.directory, 'preferences.backup.json'),
        JSON.stringify(this.value, null, 2),
      );
      await atomicWrite(join(this.directory, 'preferences.json'), JSON.stringify(next, null, 2));
      this.value = next;
      return this.snapshot();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
  async whenIdle() {
    await this.tail;
  }
}

export async function restorePreferenceBackup(directory: string) {
  const backup = preferenceSchema.parse(
    JSON.parse(await readFile(join(directory, 'preferences.backup.json'), 'utf8')),
  );
  let original: string | undefined;
  try {
    original = await readFile(join(directory, 'preferences.json'), 'utf8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (original !== undefined) {
    let valid = false;
    try {
      preferenceSchema.parse(JSON.parse(original));
      valid = true;
    } catch {
      /* Preserve invalid preferences. */
    }
    if (valid) throw new AppError('STATE_ALREADY_VALID');
    await writeFile(join(directory, `preferences.damaged.${Date.now()}.json`), original, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }
  await atomicWrite(join(directory, 'preferences.json'), JSON.stringify(backup, null, 2));
}
