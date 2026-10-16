import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { Store } from '../server/store.js';
import { WorkspaceService } from '../server/service.js';
import { createDemo } from '../server/demo.js';
import {
  git,
  worktrees,
  pathKey,
  previewUntracked,
  cleanRemote,
  inspectRepository,
} from '../server/git.js';
import type { State, CreateTaskInput } from '../shared/types.js';

const testParent = resolve(tmpdir(), 'tandem-tests');
await mkdir(testParent, { recursive: true });

async function fixture(t: TestContext, StoreClass: typeof Store = Store) {
  const root = await mkdtemp(join(testParent, 'run-'));
  t.after(async () => {
    const target = resolve(root),
      rel = relative(testParent, target);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });
  const paths = [join(root, '前端 repo'), join(root, 'backend')];
  for (let i = 0; i < paths.length; i++) {
    await mkdir(paths[i], { recursive: true });
    await git(paths[i], ['init', '-b', i === 0 ? 'main' : 'develop']);
    await writeFile(join(paths[i], 'app.txt'), `repository ${i}\nbase\n`);
    await writeFile(join(paths[i], '.gitignore'), '.env\nignored/\n');
    await git(paths[i], ['add', '.']);
    await git(paths[i], [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=' + join(root, 'empty-hooks'),
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@local.invalid',
      'commit',
      '-m',
      `Base ${i}`,
    ]);
  }
  const store = new StoreClass(join(root, 'data'));
  const service = new WorkspaceService(store);
  await service.init();
  const repos = await Promise.all(paths.map((path) => service.addRepository(path)));
  const input = (branch = 'feature/test'): CreateTaskInput => ({
    title: 'A real task',
    operationId: randomUUID(),
    repositories: repos.map((repo, i) => ({
      repositoryId: repo.id,
      mode: 'create',
      branch: `${branch}-${i}`,
      baseRef: i === 0 ? 'main' : 'develop',
    })),
  });
  return { root, paths, repos, service, store, input };
}

test('creates independent worktrees from distinct bases and preserves dirty source checkouts', async (t) => {
  const { service, paths, repos, input } = await fixture(t);
  await writeFile(join(paths[0], 'app.txt'), 'unsaved source work\n');
  await writeFile(join(paths[1], 'local-only.txt'), 'do not move me');
  const request = input(),
    task = await service.createTask(request);
  assert.equal(task.bindings.length, 2);
  assert.notEqual(task.bindings[0].baseSha, task.bindings[1].baseSha);
  for (let i = 0; i < 2; i++) {
    const binding = task.bindings[i];
    assert.equal((await git(binding.worktreePath, ['rev-parse', 'HEAD'])).trim(), binding.baseSha);
    assert.equal(
      (await git(binding.worktreePath, ['branch', '--show-current'])).trim(),
      `feature/test-${i}`,
    );
    assert.equal(
      pathKey(
        (
          await git(binding.worktreePath, [
            'rev-parse',
            '--path-format=absolute',
            '--git-common-dir',
          ])
        ).trim(),
      ),
      pathKey(repos[i].commonDir),
    );
  }
  assert.equal(await readFile(join(paths[0], 'app.txt'), 'utf8'), 'unsaved source work\n');
  assert.equal(await readFile(join(paths[1], 'local-only.txt'), 'utf8'), 'do not move me');
  assert.equal((await git(paths[0], ['branch', '--show-current'])).trim(), 'main');
  const repeated = await service.createTask(request);
  assert.equal(repeated.id, task.id);
  await assert.rejects(
    service.createTask({ ...request, title: 'Different request' }),
    (error: any) => error.code === 'OPERATION_MISMATCH',
  );
  assert.equal((await worktrees(paths[0])).length, 2);
  const resumed = new WorkspaceService(new Store(service.store.directory));
  await resumed.init();
  assert.equal(resumed.task(task.id).bindings[1].worktreePath, task.bindings[1].worktreePath);
});

test('a second-repository failure compensates the first and preserves an unrelated destination', async (t) => {
  class CollisionStore extends Store {
    fired = false;
    override async transaction<T>(fn: (draft: State) => T | Promise<T>) {
      const result = await super.transaction(fn);
      const operation = this.snapshot().operations.find(
        (o) => o.state === 'creating' && o.resources.length === 2,
      );
      if (operation && !this.fired) {
        this.fired = true;
        await mkdir(operation.resources[1].path, { recursive: true });
        await writeFile(
          join(operation.resources[1].path, 'someone-elses-work.txt'),
          'preserve this',
        );
      }
      return result;
    }
  }
  const { service, paths, input } = await fixture(t, CollisionStore);
  await assert.rejects(service.createTask(input()), (error: any) => error.code === 'GIT_ERROR');
  assert.equal((await worktrees(paths[0])).length, 1);
  assert.equal((await worktrees(paths[1])).length, 1);
  assert.equal(service.state().tasks.length, 0);
  const operation = service.state().operations[0];
  assert.equal(operation.state, 'failed');
  assert.equal(operation.resources[0].cleaned, true);
  assert.equal(
    await readFile(join(operation.resources[1].path, 'someone-elses-work.txt'), 'utf8'),
    'preserve this',
  );
  await service.recoverOperation(operation.id);
  assert.equal(
    await readFile(join(operation.resources[1].path, 'someone-elses-work.txt'), 'utf8'),
    'preserve this',
  );
});

test('rejects checked-out branches and invalid bases before changing any repository', async (t) => {
  const { service, paths, input } = await fixture(t);
  const request = input();
  request.repositories[1].branch = 'develop';
  await assert.rejects(service.createTask(request), (error: any) => error.code === 'BRANCH_IN_USE');
  assert.equal((await worktrees(paths[0])).length, 1);
  const bad = input();
  bad.repositories[1].baseRef = 'missing-base';
  await assert.rejects(service.createTask(bad), (error: any) => error.code === 'BASE_NOT_FOUND');
  assert.equal(service.state().operations.length, 0);
});

test('attaches existing dirty work, archives without deleting it, and prevents conflicting restoration', async (t) => {
  const { service, paths, repos } = await fixture(t);
  await writeFile(join(paths[0], 'local.txt'), 'unfinished');
  const request = {
    title: 'Existing work',
    operationId: randomUUID(),
    repositories: [
      {
        repositoryId: repos[0].id,
        mode: 'attach' as const,
        branch: 'main',
        baseRef: 'main',
        worktreePath: paths[0],
      },
    ],
  };
  const task = await service.createTask(request);
  assert.equal(task.bindings[0].ownership, 'attached');
  await assert.rejects(
    service.createTask({ ...request, operationId: randomUUID() }),
    (error: any) => error.code === 'WORKTREE_IN_USE',
  );
  await service.updateTask(task.id, { archivedAt: new Date().toISOString() });
  assert.equal(await readFile(join(paths[0], 'local.txt'), 'utf8'), 'unfinished');
  await service.createTask({ ...request, operationId: randomUUID() });
  await assert.rejects(
    service.updateTask(task.id, { archivedAt: null }),
    (error: any) => error.code === 'WORKTREE_IN_USE',
  );
});

test('separates staged, unstaged, untracked and committed changes with literal file paths', async (t) => {
  const { service, input } = await fixture(t);
  const task = await service.createTask(input()),
    binding = task.bindings[0];
  await writeFile(join(binding.worktreePath, 'app.txt'), 'staged-version\n');
  await git(binding.worktreePath, ['add', 'app.txt']);
  await writeFile(join(binding.worktreePath, 'app.txt'), 'working-version\n');
  await writeFile(join(binding.worktreePath, '[新文件].txt'), 'literal file content\n');
  const detail = await service.taskDetail(task.id);
  assert.equal(detail.statuses[0].files.length, 2);
  assert.equal(detail.statuses[0].branchFiles.length, 0);
  assert.match(
    (await service.diff(task.id, binding.id, 'app.txt', 'staged')).text,
    /staged-version/,
  );
  assert.match(
    (await service.diff(task.id, binding.id, 'app.txt', 'working')).text,
    /working-version/,
  );
  assert.match(
    (await service.diff(task.id, binding.id, '[新文件].txt', 'working')).text,
    /literal file content/,
  );
  await git(binding.worktreePath, [
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local.invalid',
    'commit',
    '-m',
    'Stage only',
  ]);
  assert.match(
    (await service.diff(task.id, binding.id, 'app.txt', 'branch')).text,
    /staged-version/,
  );
  await assert.rejects(
    service.diff(task.id, binding.id, '../secret.txt', 'working'),
    (error: any) => error.code === 'INVALID_FILE',
  );
  await assert.rejects(
    previewUntracked(binding.worktreePath, '../secret.txt'),
    (error: any) => error.code === 'INVALID_FILE',
  );
});

test('recovery after interruption keeps new commits, ignored files and original checkouts', async (t) => {
  const { service, store, input, paths } = await fixture(t);
  const task = await service.createTask(input());
  await writeFile(join(task.bindings[0].worktreePath, '.env'), 'LOCAL_SECRET=do-not-delete');
  await store.transaction((state) => {
    state.tasks = [];
    state.operations[0].state = 'creating';
  });
  const resumed = new WorkspaceService(new Store(store.directory));
  await resumed.init();
  assert.equal(resumed.state().operations[0].state, 'failed');
  await resumed.recoverOperation(task.operationId);
  assert.equal(
    await readFile(join(task.bindings[0].worktreePath, '.env'), 'utf8'),
    'LOCAL_SECRET=do-not-delete',
  );
  assert.equal((await worktrees(paths[0])).length, 2);
  assert.equal((await worktrees(paths[1])).length, 1);
});

test('handoffs are bilingual and omit machine paths; PR links are validated and deduplicated', async (t) => {
  const { service, input, root } = await fixture(t);
  const task = await service.createTask(input()),
    binding = task.bindings[0];
  await writeFile(join(binding.worktreePath, 'local.txt'), 'not shared');
  await service.linkPr(task.id, binding.id, 'https://github.com/example/web/pull/42');
  const linkedRevision = service.task(task.id).revision;
  await service.linkPr(task.id, binding.id, 'https://github.com/example/web/pull/42');
  assert.equal(service.task(task.id).revision, linkedRevision);
  assert.equal(service.task(task.id).bindings[0].pullRequests.length, 1);
  await assert.rejects(
    service.linkPr(task.id, binding.id, 'https://github.com.evil.invalid/example/web/pull/42'),
    (error: any) => error.code === 'INVALID_PR_URL',
  );
  await assert.rejects(
    service.linkPr(task.id, binding.id, 'https://name:secret@github.com/example/web/pull/42'),
    (error: any) => error.code === 'INVALID_PR_URL',
  );
  const english = await service.handoff(task.id, 'en'),
    chinese = await service.handoff(task.id, 'zh-CN');
  assert.match(english, /uncommitted/);
  assert.match(chinese, /未提交/);
  assert.match(english, /https:\/\/github.com\/example\/web\/pull\/42/);
  assert.ok(!english.includes(root));
  assert.ok(!chinese.includes(root));
  assert.equal(
    cleanRemote('https://user:secret@github.com/org/repo.git?token=private'),
    'https://github.com/org/repo.git',
  );
});

test('metadata transactions serialize concurrent edits and leave a readable state file', async (t) => {
  const { store } = await fixture(t);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.transaction(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, index % 3));
        state.repoSets.push({ id: randomUUID(), name: `Set ${index}`, repositoryIds: [] });
      }),
    ),
  );
  assert.equal(store.snapshot().repoSets.length, 12);
  const persisted = JSON.parse(await readFile(join(store.directory, 'state.json'), 'utf8'));
  assert.equal(persisted.repoSets.length, 12);
});

test('rejects stale task edits instead of overwriting another window', async (t) => {
  const { service, input } = await fixture(t);
  const task = await service.createTask(input());
  const updated = await service.updateTask(
    task.id,
    { description: 'Saved by the other window' },
    task.revision,
  );
  assert.equal(updated.revision, task.revision + 1);
  await assert.rejects(
    service.updateTask(task.id, { description: 'Stale overwrite' }, task.revision),
    (error: any) => error.code === 'TASK_CONFLICT',
  );
  assert.equal(service.task(task.id).description, 'Saved by the other window');
});

test('preserves corrupted state and keeps a valid previous backup', async (t) => {
  const { store, service, input } = await fixture(t);
  const task = await service.createTask(input());
  await service.updateTask(task.id, { description: 'Latest saved note' });
  const backup = await readFile(join(store.directory, 'state.backup.json'), 'utf8');
  assert.equal(JSON.parse(backup).tasks[0].id, task.id);
  await writeFile(join(store.directory, 'state.json'), '{ broken json');
  await assert.rejects(
    new Store(store.directory).init(),
    (error: any) => error.code === 'STATE_INVALID',
  );
  assert.equal(await readFile(join(store.directory, 'state.json'), 'utf8'), '{ broken json');
  assert.equal(await readFile(join(store.directory, 'state.backup.json'), 'utf8'), backup);
});

test('shows both sides of renamed files and accepts a repository subdirectory', async (t) => {
  const { service, input, paths } = await fixture(t);
  await mkdir(join(paths[0], 'nested folder'));
  assert.equal(
    pathKey((await inspectRepository(join(paths[0], 'nested folder'))).path),
    pathKey(paths[0]),
  );
  const task = await service.createTask(input()),
    binding = task.bindings[0];
  await git(binding.worktreePath, ['mv', 'app.txt', 'moved [file].txt']);
  const staged = await service.diff(task.id, binding.id, 'moved [file].txt', 'staged');
  assert.match(staged.text, /rename from app.txt/);
  assert.match(staged.text, /rename to moved \[file\].txt/);
  await git(binding.worktreePath, [
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local.invalid',
    'commit',
    '-m',
    'Rename file',
  ]);
  const committed = await service.diff(task.id, binding.id, 'moved [file].txt', 'branch');
  assert.match(committed.text, /rename from app.txt/);
  assert.match(committed.text, /rename to moved \[file\].txt/);
});

test('a missing primary state never replaces an existing backup with empty data', async (t) => {
  const { store, service, input } = await fixture(t);
  const task = await service.createTask(input());
  await service.updateTask(task.id, { description: 'Preserve the task' });
  const backup = await readFile(join(store.directory, 'state.backup.json'), 'utf8');
  await unlink(join(store.directory, 'state.json'));
  await assert.rejects(
    new Store(store.directory).init(),
    (error: any) => error.code === 'STATE_RECOVERY_REQUIRED',
  );
  assert.equal(await readFile(join(store.directory, 'state.backup.json'), 'utf8'), backup);
});

test('restarting without mutations preserves the previous backup', async (t) => {
  const { store, service, input } = await fixture(t);
  const task = await service.createTask(input());
  await service.updateTask(task.id, { description: 'New note' });
  const backup = await readFile(join(store.directory, 'state.backup.json'), 'utf8');
  await new WorkspaceService(new Store(store.directory)).init();
  assert.equal(await readFile(join(store.directory, 'state.backup.json'), 'utf8'), backup);
});

test('transaction callers cannot mutate committed state through returned references', async (t) => {
  const { store, service, input } = await fixture(t);
  const task = await service.createTask(input());
  const returned = await store.transaction((state) =>
    state.tasks.find((value) => value.id === task.id)!,
  );
  returned.description = 'Not a transaction';
  assert.notEqual(store.snapshot().tasks[0].description, 'Not a transaction');
});

test('existing branches get isolated worktrees without losing their commits on rollback', async (t) => {
  class FailingStore extends Store {
    failCommit = false;
    override async transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
      return super.transaction(async (state) => {
        const result = await fn(state);
        if (this.failCommit && state.tasks.length) {
          this.failCommit = false;
          throw new Error('simulated save failure');
        }
        return result;
      });
    }
  }
  const { service, store, paths, input } = await fixture(t, FailingStore);
  await git(paths[0], ['checkout', '-b', 'feature/pre-existing']);
  await writeFile(join(paths[0], 'existing.txt'), 'pre-existing work\n');
  await git(paths[0], ['add', 'existing.txt']);
  await git(paths[0], [
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local.invalid',
    'commit',
    '-m',
    'Existing branch work',
  ]);
  const originalHead = (await git(paths[0], ['rev-parse', 'HEAD'])).trim();
  await git(paths[0], ['checkout', 'main']);
  const request = input();
  request.repositories[0].mode = 'existing';
  request.repositories[0].branch = 'feature/pre-existing';
  (store as FailingStore).failCommit = true;
  await assert.rejects(service.createTask(request));
  assert.equal(
    (await git(paths[0], ['rev-parse', 'refs/heads/feature/pre-existing'])).trim(),
    originalHead,
  );
  assert.equal((await worktrees(paths[0])).length, 1);
  const task = await service.createTask({ ...request, operationId: randomUUID() });
  assert.equal(
    (await git(task.bindings[0].worktreePath, ['rev-parse', 'HEAD'])).trim(),
    originalHead,
  );
  assert.ok(
    (await service.taskDetail(task.id)).statuses[0].branchFiles.some(
      (file) => file.path === 'existing.txt',
    ),
  );
});

test('format-one data is preserved before the first format-two mutation', async (t) => {
  const { service, store, input } = await fixture(t);
  await service.createTask(input());
  const legacy: any = store.snapshot();
  legacy.schemaVersion = 1;
  for (const task of legacy.tasks) delete task.revision;
  for (const operation of legacy.operations)
    for (const resource of operation.resources) {
      delete resource.branchCreated;
      delete resource.startSha;
    }
  const original = JSON.stringify(legacy, null, 2);
  await writeFile(join(store.directory, 'state.json'), original);
  const migrated = new Store(store.directory);
  await migrated.init();
  assert.equal(migrated.snapshot().schemaVersion, 2);
  assert.equal(migrated.snapshot().tasks[0].revision, 0);
  assert.equal(await readFile(join(store.directory, 'state.json'), 'utf8'), original);
  await migrated.transaction((state) => {
    state.tasks[0].description = 'New version edit';
  });
  assert.equal(await readFile(join(store.directory, 'state.v1.backup.json'), 'utf8'), original);
  assert.equal(
    JSON.parse(await readFile(join(store.directory, 'state.json'), 'utf8')).schemaVersion,
    2,
  );
});

test('sample setup resumes an empty initialized repository without committing unrelated files', async (t) => {
  const { service, store } = await fixture(t);
  const source = join(store.directory, 'sample-project', 'web');
  await mkdir(source, { recursive: true });
  await git(source, ['init', '-b', 'main']);
  await writeFile(join(source, 'private.txt'), 'keep private');
  await createDemo(service);
  assert.equal(service.state().tasks.length, 3);
  assert.equal(service.state().demoLoaded, true);
  assert.equal(await readFile(join(source, 'private.txt'), 'utf8'), 'keep private');
  assert.equal((await git(source, ['ls-files', 'private.txt'])).trim(), '');
});

test('sample setup resumes after task creation without overwriting work already present', async (t) => {
  class InterruptedStore extends Store {
    interrupted = false;
    override async transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
      return super.transaction(async (state) => {
        const result = await fn(state);
        if (!this.interrupted && state.tasks.some((task) => task.demo && task.checklist.length)) {
          this.interrupted = true;
          throw new Error('interrupted sample setup');
        }
        return result;
      });
    }
  }
  const { service } = await fixture(t, InterruptedStore);
  await assert.rejects(createDemo(service));
  const first = service.state().tasks[0];
  assert.equal(first.demo, true);
  await writeFile(join(first.bindings[0].worktreePath, 'local-note.txt'), 'retain this work');
  await createDemo(service);
  assert.equal(service.state().tasks.length, 3);
  assert.equal(service.state().tasks[0].id, first.id);
  assert.equal(
    await readFile(join(first.bindings[0].worktreePath, 'local-note.txt'), 'utf8'),
    'retain this work',
  );
});
