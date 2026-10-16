import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Code2,
  Copy,
  FileCode2,
  FilePlus2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  RotateCcw,
  Share2,
  StickyNote,
  X,
} from 'lucide-react';
import type {
  Binding,
  BindingStatus,
  DiffResult,
  Locale,
  State,
  Task,
  TaskDetail as DetailData,
} from '../shared/types';
import { api, download, copyText } from './api';
import { ErrorMessage, Spinner } from './components';
import { taskTitle, type Messages } from './i18n';
import { useNoteDraft } from './useNoteDraft';
import { parseUnifiedDiff } from './unified-diff';

interface Props {
  task: Task;
  state: State;
  locale: Locale;
  t: Messages;
  revision: number;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  onHandoff: () => void;
  onRename: () => void;
  onPr: (binding: Binding) => void;
}

export function TaskDetail({
  task,
  state,
  locale,
  t,
  revision,
  onChanged,
  notify,
  onHandoff,
  onRename,
  onPr,
}: Props) {
  const [detail, setDetail] = useState<DetailData>(),
    [error, setError] = useState<unknown>();
  const [tab, setTab] = useState<'overview' | 'changes'>('overview'),
    [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false),
    [busy, setBusy] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState<Task['checklist'] | null>(null);
  const [statusDraft, setStatusDraft] = useState<Task['status'] | null>(null);
  const [checkpoint, setCheckpoint] = useState('');
  const [gitError, setGitError] = useState<unknown>();
  const description = locale === 'en' && task.descriptionEn ? task.descriptionEn : task.description;
  const note = useNoteDraft(task.id, locale, description, task.revision);
  useEffect(() => {
    setTab('overview');
    setDetail(undefined);
    setError(undefined);
  }, [task.id]);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    async function load() {
      if (!alive || inFlight) return;
      inFlight = true;
      setRefreshing(true);
      try {
        const result = await api<DetailData>(`/tasks/${task.id}`);
        if (alive) {
          setDetail(result);
          setGitError(undefined);
        }
      } catch (error) {
        if (alive) setGitError(error);
      } finally {
        inFlight = false;
        if (alive) setRefreshing(false);
      }
    }
    const visibleRefresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const timer = setInterval(visibleRefresh, 20000);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [task.id, revision, refresh]);

  async function mutate(patch: Partial<Task>, expectedRevision = task.revision) {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api<Task>(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { ...patch, expectedRevision },
      });
      await onChanged();
      return saved;
    } catch (error) {
      setError(error);
      await onChanged();
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function updateChecklist(next: Task['checklist']) {
    setChecklistDraft(next);
    try {
      return await mutate({ checklist: next });
    } finally {
      setChecklistDraft(null);
    }
  }
  async function updateStatus(next: Task['status']) {
    setStatusDraft(next);
    try {
      await mutate({ status: next });
    } finally {
      setStatusDraft(null);
    }
  }
  async function openEditor() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/tasks/${task.id}/open`, { method: 'POST' });
      notify(t.editorOpened);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function exportWorkspace() {
    try {
      const workspace = await api<object>(`/tasks/${task.id}/workspace`);
      if (
        await download(
          'task.code-workspace',
          JSON.stringify(workspace, null, 2),
          'application/json',
        )
      )
        notify(t.downloaded);
    } catch (error) {
      setError(error);
    }
  }
  async function archive() {
    if (await mutate({ archivedAt: task.archivedAt ? null : new Date().toISOString() }))
      notify(task.archivedAt ? t.taskRestored : t.taskArchived);
  }
  async function refreshPrs() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/tasks/${task.id}/refresh-prs`, { method: 'POST' });
      await onChanged();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function unlink(binding: Binding, prId: string) {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}/pr/${binding.id}/${prId}`, { method: 'DELETE' });
      await onChanged();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  const statuses = detail?.task.id === task.id ? detail.statuses : [];
  const changeCount = statuses.reduce(
    (sum, s) =>
      sum + new Set([...s.files.map((f) => f.path), ...s.branchFiles.map((f) => f.path)]).size,
    0,
  );
  const checklist = checklistDraft || task.checklist;
  const taskStatus = statusDraft || task.status;
  const done = checklist.filter((c) => c.done).length;
  const linkedPrs = task.bindings.reduce((n, b) => n + b.pullRequests.length, 0);
  const prText = {
    unknown: t.prUnknown,
    open: t.prOpen,
    draft: t.prDraft,
    merged: t.prMerged,
    closed: t.prClosed,
  };

  return (
    <section className="task-detail" aria-label={taskTitle(task, locale)}>
      <div className="detail-heading">
        <div className="detail-topline">
          <div className="detail-tools">
            <button
              className="icon-button"
              onClick={() => setRefresh((r) => r + 1)}
              disabled={refreshing}
              title={t.refresh}
              aria-label={t.refresh}
            >
              <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            </button>
            <button
              className="icon-button"
              onClick={onRename}
              title={t.renameTask}
              aria-label={t.renameTask}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button"
              onClick={archive}
              disabled={busy}
              title={task.archivedAt ? t.restoreTask : t.archiveTask}
              aria-label={task.archivedAt ? t.restoreTask : t.archiveTask}
            >
              {task.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}
            </button>
          </div>
        </div>
        <h2>{taskTitle(task, locale)}</h2>
        <div className="detail-meta">
          <label className={`status-select ${taskStatus}`}>
            <span className={`status-dot ${taskStatus}`} />
            <select
              aria-label={locale === 'zh-CN' ? '任务状态' : 'Task status'}
              value={taskStatus}
              disabled={busy}
              onChange={(e) => updateStatus(e.target.value as Task['status'])}
            >
              <option value="active">{t.active}</option>
              <option value="review">{t.review}</option>
              <option value="done">{t.done}</option>
            </select>
            <ChevronDown size={12} />
          </label>
          <span>
            {task.bindings.length} {task.bindings.length === 1 ? t.repoSingular : t.repoCount}
          </span>
          <i />
          <span>
            {done}/{checklist.length} {t.checkProgress}
          </span>
          {task.demo && <span className="tiny-sample">{t.sample}</span>}
        </div>
        <div className="detail-actions">
          <button className="button secondary" onClick={openEditor} disabled={busy}>
            <Code2 size={16} />
            {t.openEditor}
          </button>
          <button className="button primary" onClick={onHandoff}>
            <Share2 size={15} />
            {t.handoff}
          </button>
          <button
            className="icon-button workspace-download"
            title={t.downloadWorkspace}
            aria-label={t.downloadWorkspace}
            onClick={exportWorkspace}
          >
            <ArrowDownToLine size={16} />
          </button>
        </div>
        <ErrorMessage {...{ error, t }} />
        <ErrorMessage error={gitError} t={t} />
      </div>
      <div
        className="detail-tabs"
        role="tablist"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const next = tab === 'overview' ? 'changes' : 'overview';
            setTab(next);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role=tab]')
              [next === 'overview' ? 0 : 1]?.focus();
          }
        }}
      >
        <button
          role="tab"
          tabIndex={tab === 'overview' ? 0 : -1}
          aria-selected={tab === 'overview'}
          className={tab === 'overview' ? 'selected' : ''}
          onClick={() => setTab('overview')}
        >
          {t.overview}
        </button>
        <button
          role="tab"
          tabIndex={tab === 'changes' ? 0 : -1}
          aria-selected={tab === 'changes'}
          className={tab === 'changes' ? 'selected' : ''}
          onClick={() => setTab('changes')}
        >
          {t.changes}
          <span>{changeCount}</span>
        </button>
        <span className="tabs-aside">
          <span className="live-dot" />
          Git
        </span>
      </div>
      {tab === 'overview' ? (
        <div className="overview-panel" role="tabpanel">
          <div className="section-label">
            <span>{t.repositories}</span>
            <span>{task.bindings.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="bound-repositories">
            {task.bindings.map((binding) => {
              const repo = state.repositories.find((r) => r.id === binding.repositoryId)!;
              const s = statuses.find((s) => s.bindingId === binding.id);
              return (
                <div className="bound-repo" key={binding.id}>
                  <div className="bound-repo-main">
                    <span
                      className="repo-symbol"
                      style={{ '--repo-color': repo.color } as React.CSSProperties}
                    >
                      <FolderGit2 size={20} />
                    </span>
                    <div className="bound-repo-title">
                      <strong>{repo.name}</strong>
                      <button
                        className="branch-line"
                        title={`${binding.worktreePath}\n${t.copyBranch}`}
                        onClick={async () => {
                          try {
                            await copyText(s?.branch || binding.branch);
                            notify(t.copied);
                          } catch {
                            /* Clipboard may be unavailable. */
                          }
                        }}
                      >
                        <GitBranch size={12} />
                        <span>{s?.branch || binding.branch}</span>
                        <Copy size={11} className="hover-copy" />
                      </button>
                    </div>
                    <div className="repo-change-summary">
                      {!s ? (
                        <Spinner size={15} />
                      ) : s.error ? (
                        <span className="warning-text">{t.unknown}</span>
                      ) : (
                        <>
                          <span className={s.files.length ? 'modified-text' : 'clean-text'}>
                            {s.files.length ? (
                              `${s.files.length} ${s.files.length === 1 ? t.modifiedSingular : t.modified}`
                            ) : (
                              <>
                                <Check size={12} />
                                {t.clean}
                              </>
                            )}
                          </span>
                          {(s.added > 0 || s.removed > 0) && (
                            <span className="diff-numbers" title={t.trackedChanges}>
                              <b>+{s.added}</b>
                              <i>−{s.removed}</i>
                            </span>
                          )}
                          {!s.files.length && s.branchFiles.length > 0 && (
                            <span className="muted">
                              {s.branchFiles.length}{' '}
                              {s.branchFiles.length === 1 ? t.committedSingular : t.committed}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {s && !s.error && (
                    <div className="repo-tracking">
                      <span title={`${t.compareBase}: ${binding.baseSha}`}>
                        {t.base}: <code>{binding.baseRef}</code>
                      </span>
                      <span title={t.upstream}>
                        {s.ahead === null ? t.noUpstream : `↑ ${s.ahead}  ↓ ${s.behind}`}
                      </span>
                    </div>
                  )}
                  {s?.error && <ErrorMessage error={{ code: s.error }} t={t} />}
                  {s?.branchDrift && <p className="inline-warning">{t.branchDrift}</p>}
                  <div className="bound-repo-footer">
                    {binding.pullRequests.length ? (
                      <div className="pr-links">
                        {binding.pullRequests.map((pr) => (
                          <span
                            className={`pr-link ${pr.state}`}
                            key={pr.id}
                            title={pr.error ? t.prUnavailable : pr.title}
                          >
                            <a href={pr.url} target="_blank" rel="noreferrer">
                              <GitPullRequest size={13} />#{pr.number}
                              <span>{prText[pr.state]}</span>
                            </a>
                            <button
                              aria-label={t.unlinkPr}
                              title={t.unlinkPr}
                              onClick={() => unlink(binding, pr.id)}
                              disabled={busy}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="no-pr">
                        <GitPullRequest size={13} />
                        {t.noPr}
                      </span>
                    )}
                    <button className="text-button" onClick={() => onPr(binding)}>
                      <Plus size={13} />
                      {t.addPr}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {linkedPrs > 0 && (
            <div className="pr-refresh-row">
              <button className="text-button" onClick={refreshPrs} disabled={busy}>
                <RefreshCw size={13} />
                {t.refreshPr}
              </button>
            </div>
          )}
          <div className="overview-secondary">
            <section className="checklist-section">
              <div className="section-heading">
                <h3>
                  <CheckCheck size={17} />
                  {t.checklist}
                </h3>
                <span>
                  {done}
                  <small> / {checklist.length}</small>
                </span>
              </div>
              {!checklist.length && <p className="muted checklist-empty">{t.noChecklist}</p>}
              {checklist.map((item) => (
                <div className={`checklist-row ${item.done ? 'completed' : ''}`} key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={busy}
                      onChange={(e) =>
                        updateChecklist(
                          checklist.map((c) =>
                            c.id === item.id ? { ...c, done: e.target.checked } : c,
                          ),
                        )
                      }
                    />
                    <span>{locale === 'en' && item.textEn ? item.textEn : item.text}</span>
                  </label>
                  <button
                    className="icon-button"
                    aria-label={locale === 'zh-CN' ? '移除检查项' : 'Remove checkpoint'}
                    disabled={busy}
                    onClick={() => updateChecklist(checklist.filter((c) => c.id !== item.id))}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <form
                className="add-checkpoint"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (checkpoint.trim()) {
                    if (
                      await updateChecklist([
                        ...checklist,
                        { id: crypto.randomUUID(), text: checkpoint.trim(), done: false },
                      ])
                    )
                      setCheckpoint('');
                  }
                }}
              >
                <Plus size={15} />
                <input
                  aria-label={t.addCheck}
                  value={checkpoint}
                  onChange={(e) => setCheckpoint(e.target.value)}
                  placeholder={t.addCheck}
                  maxLength={300}
                  disabled={busy || checklist.length >= 50}
                />
                {checkpoint.trim() && (
                  <button className="icon-button" aria-label={t.save} disabled={busy}>
                    <ArrowRight size={16} />
                  </button>
                )}
              </form>
            </section>
            <section className="notes-section">
              <h3>
                <StickyNote size={16} />
                {t.notes}
              </h3>
              <textarea
                value={note.text}
                onChange={(e) => note.setText(e.target.value)}
                placeholder={t.notesPlaceholder}
                rows={5}
                maxLength={6000}
                aria-label={t.notes}
              />
              <div className="note-actions">
                <span className={note.dirty ? 'unsaved' : 'muted'}>
                  {note.dirty ? t.unsavedNote : t.savedNote}
                </span>
                {note.dirty && (
                  <button className="text-button" onClick={() => note.discard()} disabled={busy}>
                    {t.discardDraft}
                  </button>
                )}
                {note.dirty && (
                  <button
                    className="button secondary small-button"
                    disabled={busy}
                    onClick={async () => {
                      const submitted = note.text;
                      const saved = await mutate(
                        { description: submitted },
                        note.remotelyChanged ? task.revision : note.baseRevision,
                      );
                      if (saved) note.saved(submitted, saved.revision);
                    }}
                  >
                    {t.saveNote}
                  </button>
                )}
              </div>
              {note.storageFailed && <ErrorMessage error={{ code: 'DRAFT_STORAGE' }} t={t} />}
              {note.remotelyChanged && (
                <details className="remote-note" open>
                  <summary>{t.currentSavedNote}</summary>
                  <pre>{description}</pre>
                </details>
              )}
            </section>
          </div>
          <div className="detail-footnote">
            {t.created}{' '}
            {new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
              new Date(task.createdAt),
            )}
            <span>·</span>
            {t.localFootnote}
          </div>
        </div>
      ) : (
        <ChangesPanel key={task.id} {...{ task, state, statuses, t, refresh, revision }} />
      )}
    </section>
  );
}

function ChangesPanel({
  task,
  state,
  statuses,
  t,
  refresh,
  revision,
}: {
  task: Task;
  state: State;
  statuses: BindingStatus[];
  t: Messages;
  refresh: number;
  revision: number;
}) {
  const [bindingId, setBindingId] = useState(task.bindings[0].id);
  const binding = task.bindings.find((b) => b.id === bindingId) || task.bindings[0];
  const current = statuses.find((s) => s.bindingId === binding.id);
  const [scope, setScope] = useState<'working' | 'branch'>('working');
  const [fileQuery, setFileQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState(''),
    [layer, setLayer] = useState<'working' | 'staged' | undefined>();
  const files =
    scope === 'working'
      ? current?.files.map((f) => ({
          path: f.path,
          originalPath: f.originalPath,
          status: f.untracked ? 'U' : f.index !== ' ' ? f.index : f.worktree,
        })) || []
      : current?.branchFiles || [];
  const visibleFiles = files.filter((file) =>
    [file.path, file.originalPath || ''].some((path) =>
      path.toLowerCase().includes(fileQuery.toLowerCase()),
    ),
  );
  const file = visibleFiles.find((f) => f.path === selectedPath) || visibleFiles[0];
  const workingFile = current?.files.find((f) => f.path === file?.path);
  const hasStaged = !!workingFile && workingFile.index !== ' ' && workingFile.index !== '?';
  const hasUnstaged = !!workingFile && workingFile.worktree !== ' ';
  const mode =
    scope === 'branch'
      ? 'branch'
      : layer && ((layer === 'working' && hasUnstaged) || (layer === 'staged' && hasStaged))
        ? layer
        : hasUnstaged
          ? 'working'
          : 'staged';
  const [diff, setDiff] = useState<DiffResult>(),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setDiff(undefined);
    setError(undefined);
    if (!file) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<DiffResult>(
      `/tasks/${task.id}/diff/${binding.id}?file=${encodeURIComponent(file.path)}&mode=${mode}`,
    )
      .then((result) => {
        if (alive) setDiff(result);
      })
      .catch((error) => {
        if (alive) setError(error);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [task.id, binding.id, file?.path, mode, refresh, revision, statuses]);
  return (
    <div className="changes-panel" role="tabpanel">
      <div className="changes-repos">
        {task.bindings.map((b) => (
          <button
            key={b.id}
            className={b.id === binding.id ? 'selected' : ''}
            onClick={() => {
              setBindingId(b.id);
              setFileQuery('');
              setSelectedPath('');
              setLayer(undefined);
            }}
          >
            <FolderGit2 size={14} />
            {state.repositories.find((r) => r.id === b.repositoryId)?.name}
          </button>
        ))}
      </div>
      <div className="change-scope">
        <div className="segmented">
          <button
            className={scope === 'working' ? 'selected' : ''}
            onClick={() => {
              setScope('working');
              setSelectedPath('');
            }}
          >
            {t.working}
            <span>{current?.files.length || 0}</span>
          </button>
          <button
            className={scope === 'branch' ? 'selected' : ''}
            onClick={() => {
              setScope('branch');
              setSelectedPath('');
            }}
          >
            {t.branchChanges}
            <span>{current?.branchFiles.length || 0}</span>
          </button>
        </div>
        <p>{t.diffHelp}</p>
      </div>
      {current?.error ? (
        <ErrorMessage error={{ code: current.error }} t={t} />
      ) : !current ? (
        <div className="loading-inline">
          <Spinner />
          {t.loading}
        </div>
      ) : !files.length ? (
        <div className="empty-diff">
          <CheckCheck size={32} strokeWidth={1.2} />
          <h3>{t.noChanges}</h3>
          <p>{scope === 'working' ? t.noChangesBody : t.noBranchChanges}</p>
        </div>
      ) : (
        <>
          <div className="changed-file-list">
            <div className="file-filter">
              <Search size={12} />
              <input
                aria-label={t.fileSearch}
                placeholder={t.fileSearch}
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
              />
            </div>
            {visibleFiles.map((entry) => (
              <button
                className={entry.path === file?.path ? 'selected' : ''}
                key={entry.path}
                title={entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path}
                onClick={() => {
                  setSelectedPath(entry.path);
                  setLayer(undefined);
                }}
              >
                {entry.status === 'U' || entry.status === 'A' ? (
                  <FilePlus2 size={14} />
                ) : (
                  <FileCode2 size={14} />
                )}
                <span>{entry.path}</span>
                <b className={`file-state ${entry.status}`}>{entry.status}</b>
              </button>
            ))}
          </div>
          <div className="diff-box">
            <div className="diff-toolbar">
              <span className="mono">{file?.path}</span>
              {scope === 'working' && workingFile?.untracked ? (
                <small>{t.untracked}</small>
              ) : (
                scope === 'working' && (
                  <div className="diff-layers">
                    {hasUnstaged && (
                      <button
                        className={mode === 'working' ? 'selected' : ''}
                        onClick={() => setLayer('working')}
                      >
                        {t.unstaged}
                      </button>
                    )}
                    {hasStaged && (
                      <button
                        className={mode === 'staged' ? 'selected' : ''}
                        onClick={() => setLayer('staged')}
                      >
                        {t.staged}
                      </button>
                    )}
                  </div>
                )
              )}
            </div>
            {!file ? (
              <p className="diff-notice">{t.noFilesMatch}</p>
            ) : loading ? (
              <div className="loading-inline">
                <Spinner />
                {t.loading}
              </div>
            ) : error ? (
              <ErrorMessage {...{ error, t }} />
            ) : diff?.binary ? (
              <p className="diff-notice">{t.binaryFile}</p>
            ) : diff ? (
              <>
                <UnifiedDiff text={diff.text} empty={t.noDiff} />
                {diff.truncated && <p className="diff-notice">{t.truncated}</p>}
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function UnifiedDiff({ text, empty }: { text: string; empty: string }) {
  const lines = useMemo(() => parseUnifiedDiff(text), [text]);
  if (!text) return <p className="diff-notice">{empty}</p>;
  return (
    <div className="diff-scroll">
      <table className="diff-table" aria-label="Git diff">
        <tbody>
          {lines.map((line) => (
            <tr className={line.type} key={line.index}>
              <td className="line-number">{line.old}</td>
              <td className="line-number">{line.next}</td>
              <td className="line-sign">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ''}
              </td>
              <td className="line-content">
                <pre>{line.line || ' '}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
