import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, mkdir, rm, readdir, rename } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { acquireWorkspaceLock } from '../server/workspace-lock';
import { Store, restoreStateBackup, stateBackupInfo } from '../server/store';
import { PreferenceStore, restorePreferenceBackup } from '../desktop/preferences';
import { startApplication } from '../server/app';

async function temporary(t: any) {
  const parent = join(tmpdir(), 'tandem-reliability');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'run-'));
  t.after(async () => {
    const rel = relative(parent, resolve(directory));
    assert.ok(rel && !isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== '..');
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });
  return directory;
}

test('kernel workspace lease allows only one simultaneous writer', async (t) => {
  const directory = await temporary(t);
  const attempts = await Promise.allSettled([
    acquireWorkspaceLock(directory),
    acquireWorkspaceLock(join(directory, '.')),
  ]);
  const owners = attempts.filter((result) => result.status === 'fulfilled');
  try {
    assert.equal(owners.length, 1);
    const failure = attempts.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    assert.equal(failure.reason.code, 'WORKSPACE_BUSY');
  } finally {
    for (const owner of owners) await owner.value.release();
  }
});

test('stale modern records are recovered without mistaking a reused PID for a live owner', async (t) => {
  const directory = await temporary(t);
  const first = await acquireWorkspaceLock(directory);
  const record = await readFile(join(directory, 'server.lock'), 'utf8');
  await first.release();
  await writeFile(join(directory, 'server.lock'), record);
  const next = await acquireWorkspaceLock(directory);
  try {
    assert.notEqual(
      JSON.parse(await readFile(join(directory, 'server.lock'), 'utf8')).ownerId,
      JSON.parse(record).ownerId,
    );
  } finally {
    await next.release();
  }
});

test('live legacy writers and incomplete legacy records are not overwritten', async (t) => {
  const directory = await temporary(t),
    path = join(directory, 'server.lock');
  await writeFile(path, JSON.stringify({ pid: process.pid }));
  await assert.rejects(
    acquireWorkspaceLock(directory),
    (error: any) => error.code === 'WORKSPACE_BUSY',
  );
  await writeFile(path, '{ incomplete');
  await assert.rejects(
    acquireWorkspaceLock(directory),
    (error: any) => error.code === 'LOCK_INVALID',
  );
  assert.equal(await readFile(path, 'utf8'), '{ incomplete');
  await unlink(path);
  const lease = await acquireWorkspaceLock(directory);
  await lease.release();
});

test('failed port binding releases the workspace lease', async (t) => {
  const directory = await temporary(t),
    occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const port = (occupied.address() as import('node:net').AddressInfo).port;
  try {
    await assert.rejects(startApplication({ directory, clientDirectory: directory, port }));
    const lease = await acquireWorkspaceLock(directory);
    await lease.release();
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

test('explicit backup recovery preserves the damaged original and refuses to overwrite valid data', async (t) => {
  const directory = await temporary(t),
    store = new Store(directory);
  await store.init();
  await store.transaction((state) => {
    state.demoLoaded = true;
  });
  const backup = await readFile(join(directory, 'state.backup.json'), 'utf8');
  await writeFile(join(directory, 'state.json'), '{ damaged original');
  const lease = await acquireWorkspaceLock(directory);
  try {
    assert.deepEqual(
      await stateBackupInfo(directory).then((info) => [info.tasks, info.repositories]),
      [0, 0],
    );
    await restoreStateBackup(directory);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')),
      JSON.parse(backup),
    );
    const preserved = (await readdir(directory)).find((name) => name.startsWith('state.damaged.'))!;
    assert.equal(await readFile(join(directory, preserved), 'utf8'), '{ damaged original');
    await assert.rejects(
      restoreStateBackup(directory),
      (error: any) => error.code === 'STATE_ALREADY_VALID',
    );
  } finally {
    await lease.release();
  }
});

test('preferences keep their committed value when the next disk write fails', async (t) => {
  const directory = await temporary(t),
    store = new PreferenceStore(directory);
  await store.init();
  await store.save({ locale: 'en', dataDirectory: 'C:\\important-workspace' });
  await rename(join(directory, 'preferences.json'), join(directory, 'previous.json'));
  await mkdir(join(directory, 'preferences.json'));
  await assert.rejects(store.save({ locale: 'zh-CN', dataDirectory: 'C:\\different-workspace' }));
  assert.equal(store.snapshot().dataDirectory, 'C:\\important-workspace');
  assert.equal(store.snapshot().locale, 'en');
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.tmp')).length, 0);
});

test('missing or corrupt preferences retain their backup until explicit recovery', async (t) => {
  const directory = await temporary(t),
    store = new PreferenceStore(directory);
  await store.init();
  await store.save({ locale: 'en', dataDirectory: 'C:\\important-workspace' });
  await store.save({ selectedTaskId: 'da65b631-4fb9-42dc-938b-0215cfefabc2' });
  const originalBackup = await readFile(join(directory, 'preferences.backup.json'), 'utf8');
  await store.save({ locale: 'en' });
  assert.equal(await readFile(join(directory, 'preferences.backup.json'), 'utf8'), originalBackup);
  await unlink(join(directory, 'preferences.json'));
  await assert.rejects(
    new PreferenceStore(directory).init(),
    (error: any) => error.code === 'PREFERENCES_INVALID',
  );
  assert.equal(await readFile(join(directory, 'preferences.backup.json'), 'utf8'), originalBackup);
  await restorePreferenceBackup(directory);
  const restored = await new PreferenceStore(directory).init();
  assert.equal(restored.dataDirectory, 'C:\\important-workspace');
  await writeFile(join(directory, 'preferences.json'), '{ invalid');
  await restorePreferenceBackup(directory);
  assert.ok((await readdir(directory)).some((name) => name.startsWith('preferences.damaged.')));
});

test('API input errors are returned as actionable 400/413 responses', async (t) => {
  const directory = await temporary(t);
  const app = await startApplication({ directory, clientDirectory: directory, port: 0 });
  try {
    const { token } = (await (await fetch(`${app.origin}/api/bootstrap`)).json()) as {
      token: string;
    };
    const headers = { 'content-type': 'application/json', 'x-tandem-token': token };
    const malformed = await fetch(`${app.origin}/api/tasks`, {
      method: 'POST',
      headers,
      body: '{ incomplete',
    });
    assert.equal(malformed.status, 400);
    assert.equal(((await malformed.json()) as { code: string }).code, 'VALIDATION');
    const huge = await fetch(`${app.origin}/api/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'x'.repeat(140000) }),
    });
    assert.equal(huge.status, 413);
    assert.equal(((await huge.json()) as { code: string }).code, 'PAYLOAD_TOO_LARGE');
  } finally {
    await app.close();
  }
});

test('shutdown waits for an aborted request to finish its mutation before releasing the lease', async (t) => {
  const directory = await temporary(t),
    app = await startApplication({ directory, clientDirectory: directory, port: 0 });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  app.service.saveRepoSet = async () => {
    entered();
    await gate;
    await app.service.store.transaction((state) => {
      state.demoLoaded = true;
    });
    return { id: '4fac0789-0d10-4daa-b424-a7f62fc736b2', name: 'test', repositoryIds: [] };
  };
  const { token } = (await (await fetch(`${app.origin}/api/bootstrap`)).json()) as {
    token: string;
  };
  const controller = new AbortController();
  const request = fetch(`${app.origin}/api/sets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tandem-token': token },
    body: JSON.stringify({ name: 'test', repositoryIds: ['4fac0789-0d10-4daa-b424-a7f62fc736b2'] }),
    signal: controller.signal,
  }).catch(() => undefined);
  await started;
  controller.abort();
  const closing = app.close();
  try {
    await assert.rejects(
      acquireWorkspaceLock(directory),
      (error: any) => error.code === 'WORKSPACE_BUSY',
    );
  } finally {
    release();
    await request;
    await closing;
  }
  assert.equal(app.service.state().demoLoaded, true);
  const lease = await acquireWorkspaceLock(directory);
  await lease.release();
});

test('future data formats are not mistaken for corruption or replaced by older backups', async (t) => {
  const directory = await temporary(t),
    store = new Store(directory);
  await store.init();
  await store.transaction((state) => {
    state.demoLoaded = true;
  });
  const future = JSON.stringify({ ...store.snapshot(), schemaVersion: 3 });
  await writeFile(join(directory, 'state.json'), future);
  await assert.rejects(
    new Store(directory).init(),
    (error: any) => error.code === 'STATE_VERSION_NEWER',
  );
  await assert.rejects(
    restoreStateBackup(directory),
    (error: any) => error.code === 'STATE_VERSION_NEWER',
  );
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), future);
});
