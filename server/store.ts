import { mkdir, readFile, access, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { State } from '../shared/types.js';
import { AppError } from './errors.js';
import { stateSchema } from './state-schema.js';
import { atomicWrite } from './atomic-file.js';

export class Store {
  private state: State | undefined;
  private legacySnapshot: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(public readonly directory: string) {}

  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      try {
        const raw = await readFile(join(this.directory, 'state.json'), 'utf8');
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          Number.isInteger(parsed.schemaVersion) &&
          parsed.schemaVersion > 2
        )
          throw new AppError('STATE_VERSION_NEWER');
        this.state = stateSchema.parse(parsed);
        if (parsed.schemaVersion === 1) this.legacySnapshot = raw;
      } catch (error: any) {
        if (error.code === 'ENOENT') throw error;
        if (error instanceof SyntaxError || error.name === 'ZodError')
          throw new AppError('STATE_INVALID');
        throw error;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await access(join(this.directory, 'state.backup.json'));
        throw new AppError('STATE_RECOVERY_REQUIRED');
      } catch (backupError: any) {
        if (backupError.code !== 'ENOENT') throw backupError;
      }
      const empty: State = {
        schemaVersion: 2,
        repositories: [],
        tasks: [],
        repoSets: [],
        operations: [],
        demoLoaded: false,
      };
      await this.persist(empty);
      this.state = empty;
    }
  }

  snapshot(): State {
    if (!this.state) throw new AppError('STATE_INVALID');
    return structuredClone(this.state);
  }

  async whenIdle() {
    await this.tail;
  }

  async transaction<T>(fn: (draft: State) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const draft = this.snapshot();
      const result = await fn(draft);
      const validated = stateSchema.parse(draft);
      const detachedResult = structuredClone(result);
      if (JSON.stringify(validated) === JSON.stringify(this.state)) return detachedResult;
      await this.persist(validated);
      this.state = validated;
      return detachedResult;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async persist(state: State) {
    if (this.legacySnapshot) {
      try {
        await writeFile(join(this.directory, 'state.v1.backup.json'), this.legacySnapshot, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (this.state)
      await atomicWrite(
        join(this.directory, 'state.backup.json'),
        JSON.stringify(this.state, null, 2),
      );
    await atomicWrite(join(this.directory, 'state.json'), JSON.stringify(state, null, 2));
    this.legacySnapshot = undefined;
  }
}

export async function stateBackupInfo(directory: string) {
  const path = join(directory, 'state.backup.json');
  const backup = stateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  return {
    tasks: backup.tasks.length,
    repositories: backup.repositories.length,
    modifiedAt: (await stat(path)).mtime.toISOString(),
  };
}

// Caller must hold the workspace lease before an explicit recovery operation.
export async function restoreStateBackup(directory: string) {
  const path = join(directory, 'state.json');
  const backup = stateSchema.parse(
    JSON.parse(await readFile(join(directory, 'state.backup.json'), 'utf8')),
  );
  let original: string | undefined;
  try {
    original = await readFile(path, 'utf8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (original !== undefined) {
    try {
      const parsed = JSON.parse(original);
      if (
        parsed &&
        typeof parsed === 'object' &&
        Number.isInteger(parsed.schemaVersion) &&
        parsed.schemaVersion > 2
      )
        throw new AppError('STATE_VERSION_NEWER');
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
    let valid = false;
    try {
      stateSchema.parse(JSON.parse(original));
      valid = true;
    } catch {
      /* Keep invalid original content below. */
    }
    if (valid) throw new AppError('STATE_ALREADY_VALID');
    await writeFile(join(directory, `state.damaged.${Date.now()}.${randomUUID()}.json`), original, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }
  await atomicWrite(path, JSON.stringify(backup, null, 2));
}
