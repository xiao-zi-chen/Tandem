import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, realpath, rmdir, access } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from './store.js';
import { AppError } from './errors.js';
import {
  git,
  optionalGit,
  inspectRepository,
  worktrees,
  pathKey,
  status,
  parseBranchFiles,
  previewUntracked,
} from './git.js';
import type {
  Binding,
  BindingStatus,
  CreateTaskInput,
  Locale,
  Operation,
  PullRequest,
  Repository,
  Task,
  TaskDetail,
} from '../shared/types.js';

const exec = promisify(execFile);
const colors = ['#658771', '#7984a1', '#b48c61', '#9e7f9e', '#6f9399'];
const now = () => new Date().toISOString();
const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export class WorkspaceService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    public readonly store: Store,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async init() {
    await this.store.init();
    if (!this.store.snapshot().operations.some((operation) => operation.state === 'creating'))
      return;
    await this.store.transaction((state) => {
      for (const operation of state.operations) {
        if (operation.state === 'creating') {
          operation.state = 'failed';
          operation.error = 'INTERRUPTED';
        }
      }
    });
  }

  state() {
    return this.store.snapshot();
  }

  async whenIdle() {
    await this.queue;
    await this.store.whenIdle();
  }

  repository(id: string): Repository {
    const repo = this.state().repositories.find((r) => r.id === id);
    if (!repo) throw new AppError('REPOSITORY_NOT_FOUND', '', 404);
    return repo;
  }

  task(id: string): Task {
    const task = this.state().tasks.find((t) => t.id === id);
    if (!task) throw new AppError('TASK_NOT_FOUND', '', 404);
    return task;
  }

  async addRepository(input: string, name?: string, demo = false): Promise<Repository> {
    return this.serialized(async () => {
      const inspection = await inspectRepository(input);
      const previous = this.state().repositories.find(
        (r) => pathKey(r.commonDir) === pathKey(inspection.commonDir),
      );
      if (previous) return previous;
      const repo: Repository = {
        id: randomUUID(),
        name: name?.trim() || basename(inspection.path),
        path: inspection.path,
        commonDir: inspection.commonDir,
        remote: inspection.remote,
        defaultBranch: inspection.defaultBranch,
        color: colors[this.state().repositories.length % colors.length],
        createdAt: now(),
        demo,
      };
      await this.store.transaction((state) => {
        state.repositories.push(repo);
      });
      return repo;
    });
  }

  async repositoryInfo(id: string) {
    const repo = this.repository(id);
    const info = await inspectRepository(repo.path);
    if (pathKey(info.commonDir) !== pathKey(repo.commonDir))
      throw new AppError('REPOSITORY_CHANGED');
    return {
      ...info,
      worktrees: (await worktrees(repo.path)).filter((w) => !w.bare),
      repository: repo,
    };
  }

  async removeRepository(id: string) {
    return this.serialized(async () => {
      if (this.state().tasks.some((t) => t.bindings.some((b) => b.repositoryId === id)))
        throw new AppError('REPOSITORY_IN_USE');
      if (
        this.state().operations.some(
          (o) =>
            o.state !== 'completed' && o.resources.some((r) => r.repositoryId === id && !r.cleaned),
        )
      )
        throw new AppError('REPOSITORY_IN_USE');
      await this.store.transaction((state) => {
        state.repositories = state.repositories.filter((r) => r.id !== id);
        state.repoSets = state.repoSets
          .map((s) => ({ ...s, repositoryIds: s.repositoryIds.filter((r) => r !== id) }))
          .filter((s) => s.repositoryIds.length);
      });
    });
  }

  async saveRepoSet(name: string, repositoryIds: string[]) {
    return this.serialized(async () => {
      repositoryIds.forEach((id) => this.repository(id));
      return this.store.transaction((state) => {
        const set = { id: randomUUID(), name, repositoryIds: [...new Set(repositoryIds)] };
        state.repoSets.push(set);
        return set;
      });
    });
  }

  async createTask(
    input: CreateTaskInput,
    presentation?: Pick<Task, 'demo' | 'titleEn' | 'descriptionEn'>,
  ): Promise<Task> {
    return this.serialized(async () => {
      const requestSignature = createHash('sha256')
        .update(JSON.stringify({ ...input, operationId: undefined }))
        .digest('hex');
      const previousOperation = this.state().operations.find((o) => o.id === input.operationId);
      if (
        previousOperation?.requestSignature &&
        previousOperation.requestSignature !== requestSignature
      )
        throw new AppError('OPERATION_MISMATCH');
      const previousTask = this.state().tasks.find((t) => t.operationId === input.operationId);
      if (previousTask) return previousTask;
      if (this.state().operations.some((o) => o.id === input.operationId))
        throw new AppError('OPERATION_EXISTS');
      if (new Set(input.repositories.map((r) => r.repositoryId)).size !== input.repositories.length)
        throw new AppError('DUPLICATE_REPOSITORY');
      const taskId = randomUUID();
      const taskRoot = join(this.store.directory, 'workspaces', taskId);
      const bindings: Binding[] = [];
      const resources: Operation['resources'] = [];

      for (const selection of input.repositories) {
        const repo = this.repository(selection.repositoryId);
        const inspected = await inspectRepository(repo.path);
        if (pathKey(inspected.commonDir) !== pathKey(repo.commonDir))
          throw new AppError('REPOSITORY_CHANGED');
        let baseSha: string;
        try {
          baseSha = (
            await git(repo.path, [
              'rev-parse',
              '--verify',
              '--end-of-options',
              `${selection.baseRef}^{commit}`,
            ])
          ).trim();
        } catch {
          throw new AppError('BASE_NOT_FOUND', selection.baseRef);
        }
        const listed = await worktrees(repo.path);
        let target: string, branch: string;
        if (selection.mode === 'attach') {
          if (!selection.worktreePath) throw new AppError('WORKTREE_REQUIRED');
          let resolved: string;
          try {
            resolved = await realpath(selection.worktreePath);
          } catch {
            throw new AppError('PATH_NOT_FOUND');
          }
          const match = listed.find((w) => pathKey(w.path) === pathKey(resolved) && !w.bare);
          if (!match) throw new AppError('WORKTREE_NOT_FOUND');
          if (
            this.state().tasks.some(
              (t) =>
                !t.archivedAt &&
                t.bindings.some((b) => pathKey(b.worktreePath) === pathKey(resolved)),
            )
          )
            throw new AppError('WORKTREE_IN_USE');
          target = resolved;
          branch = match.branch || 'HEAD';
        } else {
          branch = selection.branch;
          if (branch.startsWith('-') || branch.includes('@{')) throw new AppError('INVALID_BRANCH');
          try {
            await git(repo.path, ['check-ref-format', '--branch', branch]);
          } catch {
            throw new AppError('INVALID_BRANCH', branch);
          }
          if (listed.some((w) => w.branch === branch)) throw new AppError('BRANCH_IN_USE', branch);
          const existing = await optionalGit(repo.path, [
            'rev-parse',
            '--verify',
            `refs/heads/${branch}`,
          ]);
          if (selection.mode === 'existing' && !existing)
            throw new AppError('BRANCH_NOT_FOUND', branch);
          if (selection.mode === 'create' && existing) throw new AppError('BRANCH_EXISTS', branch);
          target = join(
            taskRoot,
            `${repo.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'repo'}-${repo.id.slice(0, 6)}`,
          );
          if (await exists(target)) throw new AppError('PATH_EXISTS');
          resources.push({
            repositoryId: repo.id,
            path: target,
            branch,
            baseSha,
            created: false,
            branchCreated: selection.mode === 'create',
            startSha: selection.mode === 'existing' ? existing! : baseSha,
          });
        }
        bindings.push({
          id: randomUUID(),
          repositoryId: repo.id,
          worktreePath: target,
          branch,
          baseRef: selection.baseRef,
          baseSha,
          ownership: selection.mode === 'attach' ? 'attached' : 'created',
          pullRequests: [],
        });
      }

      const operation: Operation = {
        id: input.operationId,
        requestSignature,
        taskId,
        title: input.title,
        state: 'creating',
        createdAt: now(),
        resources,
      };
      await this.store.transaction((state) => {
        state.operations.push(operation);
      });
      try {
        await mkdir(taskRoot, { recursive: true });
        for (const resource of resources) {
          const repo = this.repository(resource.repositoryId);
          await git(
            repo.path,
            resource.branchCreated === false
              ? ['worktree', 'add', resource.path, resource.branch]
              : ['worktree', 'add', '-b', resource.branch, resource.path, resource.baseSha],
            60000,
          );
          resource.created = true;
          await this.store.transaction((state) => {
            state.operations.find((o) => o.id === operation.id)!.resources =
              structuredClone(resources);
          });
        }
        const task: Task = {
          ...presentation,
          id: taskId,
          revision: 0,
          title: input.title,
          description: input.description || '',
          status: 'active',
          bindings,
          checklist: [],
          createdAt: now(),
          updatedAt: now(),
          archivedAt: null,
          operationId: input.operationId,
        };
        await this.writeWorkspace(task);
        await this.store.transaction((state) => {
          state.tasks.push(task);
          state.operations.find((o) => o.id === operation.id)!.state = 'completed';
        });
        return task;
      } catch (error: any) {
        await this.store.transaction((state) => {
          const op = state.operations.find((o) => o.id === operation.id)!;
          op.resources = structuredClone(resources);
          op.state = 'failed';
          op.error = error.code || 'CREATE_FAILED';
        });
        await this.compensate(operation.id);
        throw error;
      }
    });
  }

  private async compensate(id: string) {
    const operation = this.state().operations.find((o) => o.id === id);
    if (!operation || operation.state === 'completed') throw new AppError('OPERATION_NOT_FOUND');
    for (const resource of [...operation.resources].reverse()) {
      if (resource.cleaned) continue;
      try {
        const repo = this.repository(resource.repositoryId);
        const matching = (await worktrees(repo.path)).find(
          (w) => pathKey(w.path) === pathKey(resource.path),
        );
        if (matching) {
          const info = await inspectRepository(resource.path);
          if (
            pathKey(info.commonDir) !== pathKey(repo.commonDir) ||
            matching.branch !== resource.branch ||
            matching.head !== (resource.startSha || resource.baseSha)
          )
            continue;
          if (
            (await status(resource.path)).length ||
            (
              await git(resource.path, [
                'ls-files',
                '--others',
                '--ignored',
                '--exclude-standard',
                '-z',
              ])
            ).length
          )
            continue;
          await git(repo.path, ['worktree', 'remove', resource.path]);
        } else if (await exists(resource.path)) {
          continue;
        }
        if (
          resource.created &&
          resource.branchCreated !== false &&
          !(await worktrees(repo.path)).some((w) => w.branch === resource.branch)
        ) {
          const branchHead = await optionalGit(repo.path, [
            'rev-parse',
            '--verify',
            `refs/heads/${resource.branch}`,
          ]);
          if (branchHead === resource.baseSha)
            await git(repo.path, [
              'update-ref',
              '-d',
              `refs/heads/${resource.branch}`,
              resource.baseSha,
            ]);
        }
        await this.store.transaction((state) => {
          state.operations
            .find((o) => o.id === id)!
            .resources.find((r) => r.path === resource.path)!.cleaned = true;
        });
      } catch {
        /* Keep the journal entry so recovery can be retried without hiding failures. */
      }
    }
    try {
      await rmdir(join(this.store.directory, 'workspaces', operation.taskId));
    } catch {
      /* Only remove an empty directory. */
    }
    return this.state().operations.find((o) => o.id === id)!;
  }

  async recoverOperation(id: string) {
    return this.serialized(() => this.compensate(id));
  }

  async updateTask(
    id: string,
    patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'checklist' | 'archivedAt'>>,
    expectedRevision?: number,
  ) {
    return this.serialized(async () => {
      this.task(id);
      return this.store.transaction((state) => {
        const task = state.tasks.find((t) => t.id === id)!;
        if (expectedRevision !== undefined && task.revision !== expectedRevision)
          throw new AppError('TASK_CONFLICT', '', 409);
        if (patch.archivedAt === null && task.archivedAt) {
          const used = new Set(
            state.tasks
              .filter((t) => t.id !== id && !t.archivedAt)
              .flatMap((t) => t.bindings)
              .map((b) => pathKey(b.worktreePath)),
          );
          if (task.bindings.some((b) => used.has(pathKey(b.worktreePath))))
            throw new AppError('WORKTREE_IN_USE');
        }
        Object.assign(task, patch, { updatedAt: now() });
        task.revision++;
        if (patch.title !== undefined) delete task.titleEn;
        if (patch.description !== undefined) delete task.descriptionEn;
        return task;
      });
    });
  }

  async inspectBinding(binding: Binding): Promise<BindingStatus> {
    try {
      const repo = this.repository(binding.repositoryId);
      const commonDir = await realpath(
        (
          await git(binding.worktreePath, [
            'rev-parse',
            '--path-format=absolute',
            '--git-common-dir',
          ])
        ).trim(),
      );
      if (pathKey(commonDir) !== pathKey(repo.commonDir)) throw new AppError('REPOSITORY_CHANGED');
      const [branch, head, files, branchRaw, numstat, upstream] = await Promise.all([
        optionalGit(binding.worktreePath, ['symbolic-ref', '--short', 'HEAD']),
        git(binding.worktreePath, ['rev-parse', 'HEAD']),
        status(binding.worktreePath),
        git(binding.worktreePath, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--name-status',
          '-z',
          `${binding.baseSha}...HEAD`,
        ]),
        git(binding.worktreePath, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'HEAD']),
        optionalGit(binding.worktreePath, [
          'rev-list',
          '--left-right',
          '--count',
          'HEAD...@{upstream}',
        ]),
      ]);
      let added = 0,
        removed = 0;
      for (const line of numstat.split('\n')) {
        const values = line.split('\t');
        added += Number(values[0]) || 0;
        removed += Number(values[1]) || 0;
      }
      const counts = upstream?.split(/\s+/).map(Number);
      return {
        bindingId: binding.id,
        branch: branch || 'HEAD',
        head: head.trim(),
        files,
        branchFiles: parseBranchFiles(branchRaw),
        added,
        removed,
        ahead: counts?.[0] ?? null,
        behind: counts?.[1] ?? null,
        branchDrift: (branch || 'HEAD') !== binding.branch,
      };
    } catch (error: any) {
      return {
        bindingId: binding.id,
        branch: binding.branch,
        head: '',
        files: [],
        branchFiles: [],
        added: 0,
        removed: 0,
        ahead: null,
        behind: null,
        branchDrift: false,
        error: error.code || 'GIT_ERROR',
      };
    }
  }

  async taskDetail(id: string): Promise<TaskDetail> {
    const task = this.task(id);
    return { task, statuses: await Promise.all(task.bindings.map((b) => this.inspectBinding(b))) };
  }

  async diff(
    taskId: string,
    bindingId: string,
    file: string,
    mode: 'working' | 'staged' | 'branch',
  ) {
    const binding = this.task(taskId).bindings.find((b) => b.id === bindingId);
    if (!binding) throw new AppError('BINDING_NOT_FOUND', '', 404);
    const current = await this.inspectBinding(binding);
    if (current.error) throw new AppError(current.error);
    if (mode === 'branch') {
      if (!current.branchFiles.some((f) => f.path === file)) throw new AppError('INVALID_FILE');
    } else {
      const entry = current.files.find((f) => f.path === file);
      if (!entry) throw new AppError('INVALID_FILE');
      if (entry.untracked) return previewUntracked(binding.worktreePath, file);
    }
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--unified=4'];
    if (mode === 'branch') args.push(`${binding.baseSha}...HEAD`);
    else if (mode === 'staged') args.push('--cached');
    const original =
      mode === 'branch'
        ? current.branchFiles.find((entry) => entry.path === file)?.originalPath
        : current.files.find((entry) => entry.path === file)?.originalPath;
    args.push('--', file);
    if (original && original !== file) args.push(original);
    const output = await git(binding.worktreePath, args);
    return {
      text: output.slice(0, 250000),
      binary: output.includes('Binary files') || output.includes('GIT binary patch'),
      truncated: output.length > 250000,
    };
  }

  async linkPr(taskId: string, bindingId: string, value: string) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      !match
    )
      throw new AppError('INVALID_PR_URL');
    const pr: PullRequest = {
      id: randomUUID(),
      url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
      owner: match[1],
      repo: match[2],
      number: Number(match[3]),
      state: 'unknown',
    };
    return this.store.transaction((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      const binding = task?.bindings.find((b) => b.id === bindingId);
      if (!binding) throw new AppError('BINDING_NOT_FOUND', '', 404);
      if (binding.pullRequests.some((p) => p.url === pr.url)) return task!;
      binding.pullRequests.push(pr);
      task!.updatedAt = now();
      task!.revision++;
      return task!;
    });
  }

  async unlinkPr(taskId: string, bindingId: string, prId: string) {
    return this.store.transaction((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      const binding = task?.bindings.find((b) => b.id === bindingId);
      if (!binding) throw new AppError('BINDING_NOT_FOUND');
      if (!binding.pullRequests.some((p) => p.id === prId)) return task!;
      binding.pullRequests = binding.pullRequests.filter((p) => p.id !== prId);
      task!.updatedAt = now();
      task!.revision++;
      return task!;
    });
  }

  async refreshPrs(id: string) {
    const task = this.task(id);
    const results = await Promise.all(
      task.bindings
        .flatMap((b) => b.pullRequests)
        .map(async (pr) => {
          try {
            const endpoint = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;
            let data: any;
            try {
              const result = await exec('gh', ['api', '--hostname', 'github.com', endpoint], {
                windowsHide: true,
                timeout: 12000,
                maxBuffer: 2 * 1024 * 1024,
              });
              data = JSON.parse(result.stdout);
            } catch {
              const response = await this.fetcher(`https://api.github.com/${endpoint}`, {
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tandem-Local' },
                signal: AbortSignal.timeout(8000),
                redirect: 'error',
              });
              if (!response.ok) throw new Error('PR_UNAVAILABLE');
              data = await response.json();
            }
            return {
              ...pr,
              state: data.merged_at
                ? 'merged'
                : data.state === 'closed'
                  ? 'closed'
                  : data.draft
                    ? 'draft'
                    : 'open',
              title: data.title,
              checkedAt: now(),
              error: undefined,
            } as PullRequest;
          } catch {
            return {
              ...pr,
              state: 'unknown',
              checkedAt: now(),
              error: 'PR_UNAVAILABLE',
            } as PullRequest;
          }
        }),
    );
    return this.store.transaction((state) => {
      const current = state.tasks.find((t) => t.id === id)!;
      for (const binding of current.bindings)
        binding.pullRequests = binding.pullRequests.map(
          (p) => results.find((r) => r.id === p.id) || p,
        );
      return current;
    });
  }

  async workspaceFile(id: string) {
    return this.writeWorkspace(this.task(id));
  }

  private async writeWorkspace(task: Task) {
    const directory = join(this.store.directory, 'workspaces', task.id);
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'task.code-workspace');
    await writeFile(
      file,
      JSON.stringify(
        {
          folders: task.bindings.map((b) => ({
            name: this.repository(b.repositoryId).name,
            path: b.worktreePath,
          })),
          settings: { 'git.openRepositoryInParentFolders': 'never' },
        },
        null,
        2,
      ),
    );
    return file;
  }

  async openWorkspace(id: string) {
    const file = await this.workspaceFile(id);
    const candidates: string[] = [];
    if (process.platform === 'win32') {
      try {
        const { stdout } = await exec('where.exe', ['code'], { windowsHide: true, timeout: 5000 });
        for (const command of stdout.trim().split(/\r?\n/))
          candidates.push(resolve(command, '..', '..', 'Code.exe'));
      } catch {
        /* Use standard installation locations below. */
      }
      if (process.env.LOCALAPPDATA)
        candidates.push(
          join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        );
      if (process.env.ProgramFiles)
        candidates.push(join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'));
    } else if (process.platform === 'darwin')
      candidates.push('/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
    for (const executable of candidates) {
      if (!(await exists(executable))) continue;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, ['--new-window', file], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
      return;
    }
    if (process.platform !== 'win32') {
      try {
        await exec('code', ['--new-window', file], { timeout: 10000 });
        return;
      } catch {
        /* Report a useful fallback. */
      }
    }
    throw new AppError('EDITOR_NOT_FOUND');
  }

  async handoff(id: string, locale: Locale) {
    const { task, statuses } = await this.taskDetail(id);
    const zh = locale === 'zh-CN';
    const title = !zh && task.titleEn ? task.titleEn : task.title;
    const description = !zh && task.descriptionEn ? task.descriptionEn : task.description;
    const escape = (value: string) => value.replace(/[\r\n|]/g, ' ').replace(/`/g, '\\`');
    const lines = [
      `# ${title}`,
      '',
      `${zh ? '任务状态' : 'Task status'}: ${{ active: zh ? '进行中' : 'In progress', review: zh ? '待审查' : 'In review', done: zh ? '已完成' : 'Done' }[task.status]}`,
      '',
      description,
      '',
      `| ${zh ? '仓库' : 'Repository'} | ${zh ? '分支' : 'Branch'} | ${zh ? '起始提交' : 'Base commit'} | ${zh ? '工作区状态' : 'Working tree'} |`,
      '| --- | --- | --- | --- |',
    ];
    for (const binding of task.bindings) {
      const repo = this.repository(binding.repositoryId),
        s = statuses.find((s) => s.bindingId === binding.id)!;
      const state = s.error
        ? zh
          ? '无法读取'
          : 'Unavailable'
        : s.files.length
          ? zh
            ? `${s.files.length} 个未提交文件`
            : `${s.files.length} uncommitted files`
          : zh
            ? '干净'
            : 'Clean';
      lines.push(
        `| ${escape(repo.name)} | \`${escape(s.branch)}\` | \`${binding.baseSha.slice(0, 12)}\` | ${state} |`,
      );
    }
    lines.push('', `## ${zh ? '关联 PR' : 'Linked pull requests'}`, '');
    for (const binding of task.bindings) {
      const repo = this.repository(binding.repositoryId);
      if (!binding.pullRequests.length)
        lines.push(`- **${escape(repo.name)}** — ${zh ? '尚未关联 PR' : 'No PR linked'}`);
      for (const pr of binding.pullRequests)
        lines.push(
          `- **${escape(repo.name)}** — ${pr.url} (${{ unknown: zh ? '未确认' : 'Unverified', open: zh ? '开放' : 'Open', draft: zh ? '草稿' : 'Draft', merged: zh ? '已合并' : 'Merged', closed: zh ? '已关闭' : 'Closed' }[pr.state]})`,
        );
    }
    if (task.checklist.length)
      lines.push(
        '',
        `## ${zh ? '检查清单' : 'Checklist'}`,
        '',
        ...task.checklist.map(
          (item) => `- [${item.done ? 'x' : ' '}] ${!zh && item.textEn ? item.textEn : item.text}`,
        ),
      );
    if (statuses.some((s) => s.files.length))
      lines.push(
        '',
        `> ${zh ? '部分修改尚未提交；此交接单不包含本地文件内容。请在交接前提交并推送需要共享的修改。' : 'Some changes are uncommitted. This handoff does not include local file contents. Commit and push changes that need to be shared.'}`,
      );
    lines.push(
      '',
      `---`,
      zh
        ? '由同序生成 · 各仓库保留独立 Git 历史'
        : 'Made with Tandem · Every repository keeps its own Git history',
      '',
    );
    return lines.join('\n');
  }
}
