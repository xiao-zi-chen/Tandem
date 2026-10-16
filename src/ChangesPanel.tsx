import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  Columns2,
  FileCode2,
  FilePlus2,
  FolderGit2,
  GitBranch,
  List,
  Maximize2,
  Minimize2,
  Search,
  WrapText,
  X,
} from 'lucide-react';
import type { BindingStatus, DiffResult, State, Task } from '../shared/types';
import { api } from './api';
import { ErrorMessage, Spinner } from './components';
import type { Messages } from './i18n';
import { readLocal, writeLocal } from './storage';
import { DiffViewer } from './DiffViewer';
import { WorktreeActions } from './WorktreeActions';

export function ChangesPanel({
  task,
  state,
  statuses,
  t,
  refresh,
  revision,
  notify,
}: {
  task: Task;
  state: State;
  statuses: BindingStatus[];
  t: Messages;
  refresh: number;
  revision: number;
  notify: (text: string) => void;
}) {
  const [repositoryId, setRepositoryId] = useState('all');
  const [scope, setScope] = useState<'working' | 'branch'>('working');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [layer, setLayer] = useState<'working' | 'staged'>();
  const [layout, setLayout] = useState<'unified' | 'split'>(() =>
    readLocal('tandem.diff.layout') === 'split' ? 'split' : 'unified',
  );
  const [wrap, setWrap] = useState(() => readLocal('tandem.diff.wrap') === 'true');
  const [focused, setFocused] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; result: DiffResult }>();
  const [error, setError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const groups = useMemo(
    () =>
      task.bindings.map((binding) => {
        const status = statuses.find((item) => item.bindingId === binding.id);
        const repository = state.repositories.find((repo) => repo.id === binding.repositoryId)!;
        const files =
          scope === 'working'
            ? status?.files.map((file) => ({
                path: file.path,
                originalPath: file.originalPath,
                status: file.untracked ? 'U' : file.index !== ' ' ? file.index : file.worktree,
              })) || []
            : status?.branchFiles || [];
        return {
          binding,
          status,
          repository,
          files: files.map((file) => ({
            ...file,
            binding,
            repository,
            key: JSON.stringify([binding.id, file.path]),
          })),
        };
      }),
    [task.bindings, state.repositories, statuses, scope],
  );
  const selectedGroups = groups.filter(
    (group) => repositoryId === 'all' || group.binding.id === repositoryId,
  );
  const visibleGroups = selectedGroups.map((group) => ({
    ...group,
    files: group.files.filter((file) =>
      [file.path, file.originalPath || '', group.repository.name].some((value) =>
        value.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    ),
  }));
  const entries = visibleGroups.flatMap((group) => group.files);
  const selected = entries.find((entry) => entry.key === selectedKey) || entries[0];
  const current = statuses.find((status) => status.bindingId === selected?.binding.id);
  const working = current?.files.find((file) => file.path === selected?.path);
  const hasStaged = !!working && working.index !== ' ' && working.index !== '?';
  const hasUnstaged = !!working && working.worktree !== ' ';
  const mode =
    scope === 'branch'
      ? 'branch'
      : layer && ((layer === 'working' && hasUnstaged) || (layer === 'staged' && hasStaged))
        ? layer
        : hasUnstaged
          ? 'working'
          : 'staged';
  const diffKey = selected ? JSON.stringify([task.id, selected.key, mode]) : '';
  const diff = loaded?.key === diffKey ? loaded.result : undefined;
  const selectedIndex = entries.findIndex((entry) => entry.key === selected?.key);
  const total = selectedGroups.reduce((count, group) => count + group.files.length, 0);
  const countFor = (value: 'working' | 'branch') =>
    selectedGroups.reduce(
      (count, group) =>
        count +
        (value === 'working'
          ? group.status?.files.length || 0
          : group.status?.branchFiles.length || 0),
      0,
    );
  useEffect(() => {
    writeLocal('tandem.diff.layout', layout);
    writeLocal('tandem.diff.wrap', String(wrap));
  }, [layout, wrap]);
  useEffect(() => {
    if (!selected) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    api<DiffResult>(
      `/tasks/${task.id}/diff/${selected.binding.id}?file=${encodeURIComponent(selected.path)}&mode=${mode}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ key: diffKey, result });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [task.id, selected?.binding.id, selected?.path, mode, diffKey, statuses, refresh, revision]);

  function select(key: string) {
    setSelectedKey(key);
    setLayer(undefined);
    setActionError(undefined);
  }
  function move(offset: number) {
    const next = entries[selectedIndex + offset];
    if (next) select(next.key);
  }
  return (
    <div className={`review-panel ${focused ? 'is-focused' : ''}`} role="tabpanel">
      <div className="review-topline">
        <div className="changes-repos" aria-label={t.repositories}>
          <button
            className={repositoryId === 'all' ? 'selected' : ''}
            aria-pressed={repositoryId === 'all'}
            onClick={() => {
              setRepositoryId('all');
              setLayer(undefined);
            }}
          >
            {t.allRepositories}
            <span>{groups.reduce((sum, group) => sum + group.files.length, 0)}</span>
          </button>
          {groups.map((group) => (
            <button
              key={group.binding.id}
              className={repositoryId === group.binding.id ? 'selected' : ''}
              aria-pressed={repositoryId === group.binding.id}
              onClick={() => {
                setRepositoryId(group.binding.id);
                setLayer(undefined);
              }}
            >
              <FolderGit2 size={14} />
              {group.repository.name}
              <span>{group.status?.error ? '!' : group.status ? group.files.length : '…'}</span>
            </button>
          ))}
        </div>
        <button
          className="icon-button focus-review"
          aria-label={focused ? t.exitFocus : t.focusReview}
          title={focused ? t.exitFocus : t.focusReview}
          aria-pressed={focused}
          onClick={() => setFocused(!focused)}
        >
          {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
      <div className="review-controls">
        <div className="segmented">
          {(['working', 'branch'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={scope === value}
              className={scope === value ? 'selected' : ''}
              onClick={() => {
                setScope(value);
                setLayer(undefined);
              }}
            >
              {value === 'working' ? t.working : t.branchChanges}
              <span>{countFor(value)}</span>
            </button>
          ))}
        </div>
        <div className="review-display">
          <div className="segmented" aria-label={t.diffLayout}>
            <button
              className={layout === 'unified' ? 'selected' : ''}
              aria-pressed={layout === 'unified'}
              aria-label={t.unifiedDiff}
              title={t.unifiedDiff}
              onClick={() => setLayout('unified')}
            >
              <List size={15} />
            </button>
            <button
              className={layout === 'split' ? 'selected' : ''}
              aria-pressed={layout === 'split'}
              aria-label={t.splitDiff}
              title={t.splitDiff}
              onClick={() => setLayout('split')}
            >
              <Columns2 size={15} />
            </button>
          </div>
          <button
            className={`icon-button ${wrap ? 'selected' : ''}`}
            aria-label={t.wrapLines}
            title={t.wrapLines}
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText size={16} />
          </button>
        </div>
      </div>
      <div className="changed-file-list" aria-label={t.changedFiles}>
        <div className="file-filter">
          <Search size={14} />
          <input
            aria-label={t.fileSearch}
            placeholder={t.fileSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button className="icon-button" aria-label={t.clearFilter} onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <div className="review-file-count">
          {entries.length}
          {query && ` / ${total}`} {t.filesLabel}
        </div>
        <div
          className="file-groups"
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('.review-file'),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : Math.max(
                      0,
                      Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                    );
            buttons[next]?.focus();
            buttons[next]?.click();
          }}
        >
          {visibleGroups.map((group) => (
            <section className="file-group" key={group.binding.id}>
              <div className="file-group-heading">
                <span style={{ background: group.repository.color }} />
                <strong>{group.repository.name}</strong>
                <span>{group.files.length}</span>
              </div>
              {!group.status ? (
                <div className="file-group-notice">
                  <Spinner size={14} />
                  {t.loading}
                </div>
              ) : group.status.error ? (
                <ErrorMessage error={{ code: group.status.error }} t={t} />
              ) : group.files.length ? (
                group.files.map((file) => (
                  <button
                    className={`review-file ${file.key === selected?.key ? 'selected' : ''}`}
                    key={file.key}
                    aria-pressed={file.key === selected?.key}
                    title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
                    onClick={() => select(file.key)}
                  >
                    {file.status === 'U' || file.status === 'A' ? (
                      <FilePlus2 size={14} />
                    ) : (
                      <FileCode2 size={14} />
                    )}
                    <span>{file.path}</span>
                    <b className={`file-state ${file.status}`}>{file.status}</b>
                  </button>
                ))
              ) : (
                <p className="file-group-notice">{query ? t.noFilesMatch : t.noChanges}</p>
              )}
            </section>
          ))}
        </div>
      </div>
      <div className="diff-box">
        {selected ? (
          <>
            <div className="diff-toolbar">
              <div className="review-file-title">
                <span>{selected.repository.name}</span>
                <strong className="mono" title={selected.path}>
                  {selected.path}
                </strong>
                {selected.originalPath && (
                  <small title={selected.originalPath}>← {selected.originalPath}</small>
                )}
              </div>
              <div className="review-file-actions">
                {loading && <Spinner size={13} />}
                <WorktreeActions
                  taskId={task.id}
                  binding={selected.binding}
                  {...{ t, notify }}
                  onError={setActionError}
                />
                <button
                  className="icon-button"
                  aria-label={t.previousFile}
                  title={t.previousFile}
                  disabled={selectedIndex <= 0}
                  onClick={() => move(-1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t.nextFile}
                  title={t.nextFile}
                  disabled={selectedIndex >= entries.length - 1}
                  onClick={() => move(1)}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
            <div className="review-file-meta">
              <span className="review-branch" title={current?.branch || selected.binding.branch}>
                <GitBranch size={12} />
                {current?.branch || selected.binding.branch}
              </span>
              {scope === 'branch' ? (
                <span title={selected.binding.baseSha}>
                  {t.base}: {selected.binding.baseRef}
                </span>
              ) : working?.untracked ? (
                <span>{t.untracked}</span>
              ) : (
                <div className="diff-layers">
                  {hasUnstaged && (
                    <button
                      className={mode === 'working' ? 'selected' : ''}
                      aria-pressed={mode === 'working'}
                      onClick={() => setLayer('working')}
                    >
                      {t.unstaged}
                    </button>
                  )}
                  {hasStaged && (
                    <button
                      className={mode === 'staged' ? 'selected' : ''}
                      aria-pressed={mode === 'staged'}
                      onClick={() => setLayer('staged')}
                    >
                      {t.staged}
                    </button>
                  )}
                </div>
              )}
            </div>
            <ErrorMessage error={actionError} t={t} />
            {error ? (
              <ErrorMessage error={error} t={t} />
            ) : diff ? (
              diff.binary ? (
                <p className="diff-notice">{t.binaryFile}</p>
              ) : (
                <>
                  {(!diff.truncated || diff.text) && (
                    <DiffViewer key={diffKey} text={diff.text} {...{ layout, wrap, t }} />
                  )}
                  {diff.truncated && <p className="diff-notice">{t.truncated}</p>}
                </>
              )
            ) : (
              <div className="loading-inline">
                <Spinner />
                {t.loading}
              </div>
            )}
          </>
        ) : selectedGroups.some((group) => !group.status) ? (
          <div className="loading-inline">
            <Spinner />
            {t.loading}
          </div>
        ) : (
          <div className="empty-diff">
            <CheckCheck size={30} strokeWidth={1.3} />
            <h3>
              {selectedGroups.some((group) => group.status?.error)
                ? t.selectFile
                : query
                  ? t.noFilesMatch
                  : t.noChanges}
            </h3>
            <p>{query ? t.searchAllFiles : t.diffHelp}</p>
          </div>
        )}
      </div>
    </div>
  );
}
