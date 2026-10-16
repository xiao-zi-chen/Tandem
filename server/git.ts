import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, lstat, readFile, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, dirname, basename, join } from 'node:path';
import type { ChangedFile, Worktree, DiffResult } from '../shared/types.js';
import { AppError } from './errors.js';

const exec = promisify(execFile);
function canonicalPath(path: string): string {
  let candidate = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      return join(realpathSync.native(candidate), ...suffix);
    } catch (error: any) {
      const parent = dirname(candidate);
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) || parent === candidate) return resolve(path);
      // Planned worktrees may not exist yet, but their parent can still have a
      // Windows short-name or junction alias. Do not cache filesystem identity.
      suffix.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

export const pathKey = (path: string) => {
  const canonical = canonicalPath(path);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
};
let running = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  if (running < 8) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

export async function git(cwd: string, args: string[], timeout = 20000): Promise<string> {
  await acquire();
  try {
    // Trust only this explicitly selected/application-created directory for this
    // invocation. This supports Windows volumes without ownership metadata and
    // never changes the user's global safe.directory configuration.
    const result = await exec(
      'git',
      [
        '--no-optional-locks',
        '-c',
        `safe.directory=${canonicalPath(cwd).replace(/\\/g, '/')}`,
        '-c',
        'core.quotepath=false',
        '-c',
        'color.ui=false',
        ...args,
      ],
      {
        cwd,
        windowsHide: true,
        encoding: 'utf8',
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
          GIT_LITERAL_PATHSPECS: '1',
        },
      },
    );
    return result.stdout;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      try {
        await access(cwd);
      } catch {
        throw new AppError('PATH_NOT_FOUND');
      }
      throw new AppError('GIT_NOT_FOUND');
    }
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new AppError('OUTPUT_LIMIT');
    if (error.killed) throw new AppError('GIT_TIMEOUT');
    throw new AppError('GIT_ERROR', String(error.stderr || error.message).slice(0, 2000));
  } finally {
    release();
  }
}

export async function optionalGit(cwd: string, args: string[]) {
  try {
    return (await git(cwd, args)).trim();
  } catch {
    return null;
  }
}

export async function inspectRepository(input: string) {
  if (!isAbsolute(input)) throw new AppError('ABSOLUTE_PATH_REQUIRED');
  let candidate: string;
  try {
    candidate = await realpath(input);
  } catch {
    throw new AppError('PATH_NOT_FOUND', input);
  }
  if (!(await lstat(candidate)).isDirectory()) throw new AppError('NOT_A_REPOSITORY', input);
  // Resolve a selected subfolder to its nearest Git root before applying the
  // exact-directory trust setting required on some Windows volumes.
  let root = candidate;
  while (true) {
    try {
      await access(resolve(root, '.git'));
      candidate = root;
      break;
    } catch {
      /* Keep looking. */
    }
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  let path: string;
  try {
    path = await realpath((await git(candidate, ['rev-parse', '--show-toplevel'])).trim());
  } catch (error: any) {
    if (['GIT_NOT_FOUND', 'GIT_TIMEOUT', 'PATH_NOT_FOUND'].includes(error.code)) throw error;
    throw new AppError('NOT_A_REPOSITORY', input);
  }
  const commonDir = await realpath(
    (await git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(),
  );
  const head = await optionalGit(path, ['rev-parse', '--verify', 'HEAD']);
  if (!head) throw new AppError('EMPTY_REPOSITORY');
  const originHead = await optionalGit(path, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  const current = await optionalGit(path, ['symbolic-ref', '--short', 'HEAD']);
  const branches = (
    await git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])
  )
    .trim()
    .split('\n')
    .filter((b) => b && !b.endsWith('/HEAD'));
  const defaultBranch =
    originHead ||
    (branches.includes('main')
      ? 'main'
      : branches.includes('master')
        ? 'master'
        : current || 'HEAD');
  const localBranches = (
    await git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  return {
    path,
    commonDir,
    defaultBranch,
    remote: cleanRemote(await optionalGit(path, ['remote', 'get-url', 'origin'])),
    branches,
    localBranches,
    current: current || 'HEAD',
  };
}

export function cleanRemote(remote: string | null): string | null {
  if (!remote) return null;
  if (/^git@[\w.-]+:[\w./-]+$/.test(remote)) return remote;
  try {
    const url = new URL(remote);
    if (!['https:', 'http:', 'ssh:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function worktrees(path: string): Promise<Worktree[]> {
  const raw = await git(path, ['worktree', 'list', '--porcelain', '-z']);
  const result: Worktree[] = [];
  let current: Worktree | undefined;
  for (const field of raw.split('\0')) {
    if (field.startsWith('worktree ')) {
      current = { path: field.slice(9), branch: '', head: '', bare: false, locked: false };
      result.push(current);
    } else if (current) {
      if (field.startsWith('HEAD ')) current.head = field.slice(5);
      if (field.startsWith('branch refs/heads/')) current.branch = field.slice(18);
      if (field === 'bare') current.bare = true;
      if (field.startsWith('locked')) current.locked = true;
    }
  }
  return result;
}

export function parseStatus(raw: string): ChangedFile[] {
  const entries = raw.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (item.length < 4) continue;
    const index = item[0],
      worktree = item[1],
      path = item.slice(3);
    const renamed = index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C';
    files.push({
      path,
      index,
      worktree,
      untracked: index === '?' && worktree === '?',
      ...(renamed ? { originalPath: entries[++i] } : {}),
    });
  }
  return files;
}

export async function status(path: string) {
  return parseStatus(await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
}

export function parseBranchFiles(raw: string) {
  const entries = raw.split('\0'),
    result: { path: string; status: string; originalPath?: string }[] = [];
  for (let i = 0; i < entries.length - 1; i += 2) {
    const state = entries[i];
    if (!state) continue;
    if (state.startsWith('R') || state.startsWith('C')) {
      result.push({ path: entries[i + 2], status: state[0], originalPath: entries[i + 1] });
      i++;
    } else result.push({ path: entries[i + 1], status: state });
  }
  return result;
}

export async function previewUntracked(root: string, file: string): Promise<DiffResult> {
  const target = resolve(root, file);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel))
    throw new AppError('INVALID_FILE');
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new AppError('FILE_UNAVAILABLE');
  const canonical = await realpath(target);
  const rootPath = await realpath(root);
  const physical = relative(rootPath, canonical);
  if (physical.startsWith(`..${sep}`) || physical === '..' || isAbsolute(physical))
    throw new AppError('INVALID_FILE');
  if (info.size > 512 * 1024) return { text: '', binary: false, truncated: true };
  const buffer = await readFile(canonical);
  if (buffer.includes(0)) return { text: '', binary: true, truncated: false };
  const text = buffer.toString('utf8');
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  return {
    text: `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => '+' + line).join('\n')}`,
    binary: false,
    truncated: false,
  };
}
