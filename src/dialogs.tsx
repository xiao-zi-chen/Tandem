import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  FolderGit2,
  GitBranch,
  Link2,
  Plus,
  Search,
} from 'lucide-react';
import type { Binding, Locale, Repository, State, Task, Worktree } from '../shared/types';
import { api, download, copyText, RequestError } from './api';
import { ErrorMessage, Modal, Spinner } from './components';
import { taskTitle, type Messages } from './i18n';
import { matchesTask } from './task-search';

type Common = {
  t: Messages;
  onClose: () => void;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
};

const normalizePath = (value: string) => {
  const normalized = value.replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
};

export function AddRepositoryDialog({ t, onClose, onChanged, notify }: Common) {
  const [path, setPath] = useState(''),
    [name, setName] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/repositories', {
        method: 'POST',
        body: {
          path: path.trim().replace(/^"|"$/g, ''),
          ...(name.trim() ? { name: name.trim() } : {}),
        },
      });
      await onChanged();
      notify(t.repoAdded);
      onClose();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t.addRepoTitle} subtitle={t.addRepoBody} {...{ t, onClose, busy }}>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="field">
            <span>{t.repoPathLabel}</span>
            <input
              autoComplete="off"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t.repoPathPlaceholder}
              required
              className="mono"
            />
          </label>
          {window.tandem && (
            <button
              type="button"
              className="button secondary browse-button"
              disabled={busy}
              onClick={async () => {
                try {
                  const selected = await window.tandem!.chooseRepository();
                  if (selected) setPath(selected);
                } catch (error) {
                  setError(error);
                }
              }}
            >
              <FolderGit2 size={16} />
              {t.browseFolder}
            </button>
          )}
          <label className="field">
            <span>
              {t.repoNameLabel} <small>{t.optional}</small>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.repoNamePlaceholder}
              maxLength={120}
            />
          </label>
          <ErrorMessage {...{ error, t }} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button className="button primary" disabled={busy || !path.trim()}>
            {busy ? <Spinner /> : <FolderGit2 size={16} />}
            {t.connect}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

interface RepositoryInfo {
  repository: Repository;
  branches: string[];
  localBranches: string[];
  worktrees: Worktree[];
  defaultBranch: string;
}
interface Selection {
  branch?: string;
  baseRef?: string;
  worktreePath?: string;
  useExisting?: boolean;
}

export function CreateTaskDialog({
  t,
  state,
  preselected = [],
  onClose,
  onChanged,
  onCreated,
  notify,
  onAddRepository,
}: Common & {
  state: State;
  preselected?: string[];
  onCreated: (task: Task) => void;
  onAddRepository: () => void;
}) {
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState('');
  const [mode, setMode] = useState<'create' | 'attach'>('create');
  const [selected, setSelected] = useState<Record<string, Selection>>(() =>
    Object.fromEntries(preselected.map((id) => [id, {}])),
  );
  const [information, setInformation] = useState<Record<string, RepositoryInfo>>({});
  const [repoErrors, setRepoErrors] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const operationId = useRef(crypto.randomUUID());
  const fallback = useRef(
    `task/${new Date().toISOString().slice(0, 10)}-${operationId.current.slice(0, 4)}`,
  );
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  const suggested = slug ? `feature/${slug}` : fallback.current;
  const chosen = Object.keys(selected);
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function loadInfo(id: string) {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    setRepoErrors((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
    try {
      const info = await api<RepositoryInfo>(`/repositories/${id}`);
      if (mounted.current) setInformation((old) => ({ ...old, [id]: info }));
    } catch (error) {
      if (mounted.current) setRepoErrors((old) => ({ ...old, [id]: error }));
    } finally {
      requested.current.delete(id);
    }
  }
  const selectedKey = chosen.slice().sort().join(',');
  useEffect(() => {
    for (const id of chosen) if (!information[id] && !repoErrors[id]) void loadInfo(id);
  }, [selectedKey, state.repositories]);

  function update(id: string, patch: Selection) {
    setSelected((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  }
  const used = new Set(
    state.tasks
      .filter((t) => !t.archivedAt)
      .flatMap((t) => t.bindings)
      .map((b) => normalizePath(b.worktreePath)),
  );
  function available(tree: Worktree) {
    return !used.has(normalizePath(tree.path));
  }
  const checkout = (id: string) =>
    selected[id]?.worktreePath || information[id]?.worktrees.find(available)?.path || '';
  const existingBranches = (id: string) =>
    information[id]?.localBranches.filter(
      (branch) => !information[id].worktrees.some((tree) => tree.branch === branch),
    ) || [];
  const selectedBranch = (id: string) =>
    selected[id]?.branch || (selected[id]?.useExisting ? existingBranches(id)[0] || '' : suggested);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen.length) return;
    setBusy(true);
    setError(undefined);
    try {
      const task = await api<Task>('/tasks', {
        method: 'POST',
        body: {
          title: title.trim(),
          description,
          operationId: operationId.current,
          repositories: chosen.map((id) => ({
            repositoryId: id,
            mode: mode === 'create' && selected[id].useExisting ? 'existing' : mode,
            branch: selectedBranch(id) || suggested,
            baseRef: selected[id].baseRef || information[id].defaultBranch,
            ...(mode === 'attach' ? { worktreePath: checkout(id) } : {}),
          })),
        },
      });
      await onChanged();
      onCreated(task);
      notify(t.taskCreated);
      onClose();
    } catch (error) {
      setError(error);
      if ((error as RequestError).code !== 'NETWORK') operationId.current = crypto.randomUUID();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t.taskTitle} subtitle={t.taskBody} {...{ t, onClose, busy }} wide>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="field">
            <span>{t.nameLabel}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.namePlaceholder}
              required
              maxLength={120}
            />
          </label>
          <div className="mode-options">
            <button
              type="button"
              className={mode === 'create' ? 'selected' : ''}
              onClick={() => setMode('create')}
            >
              <GitBranch size={18} />
              <strong>{t.createMode}</strong>
              <span>{t.createModeBody}</span>
            </button>
            <button
              type="button"
              className={mode === 'attach' ? 'selected' : ''}
              onClick={() => setMode('attach')}
            >
              <Link2 size={18} />
              <strong>{t.attachMode}</strong>
              <span>{t.attachModeBody}</span>
            </button>
          </div>
          <div>
            <label className="field-label">{t.chooseRepos}</label>
            {state.repoSets.length > 0 && (
              <div className="preset-chips">
                {state.repoSets.map((set) => (
                  <button
                    key={set.id}
                    className="chip"
                    type="button"
                    onClick={() =>
                      setSelected(
                        Object.fromEntries(set.repositoryIds.map((id) => [id, selected[id] || {}])),
                      )
                    }
                  >
                    {set.name}
                    <ArrowRight size={12} />
                  </button>
                ))}
              </div>
            )}
            {!state.repositories.length ? (
              <div className="no-repos-inline">
                <p>{t.noRepo}</p>
                <button type="button" className="button secondary" onClick={onAddRepository}>
                  <Plus size={15} />
                  {t.addRepo}
                </button>
              </div>
            ) : (
              <div className="repo-selections">
                {state.repositories.map((repo) => {
                  const checked = !!selected[repo.id],
                    info = information[repo.id];
                  return (
                    <div
                      className={`repo-selection ${checked ? 'checked' : ''}`}
                      key={repo.id}
                      role="group"
                      aria-label={repo.name}
                    >
                      <label className="repo-selection-head">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelected((old) => {
                              const next = { ...old };
                              if (e.target.checked) next[repo.id] = {};
                              else delete next[repo.id];
                              return next;
                            })
                          }
                        />
                        <span
                          className="repo-symbol"
                          style={{ '--repo-color': repo.color } as React.CSSProperties}
                        >
                          <FolderGit2 size={17} />
                        </span>
                        <strong>{repo.name}</strong>
                        <span className="mono selection-base">{repo.defaultBranch}</span>
                      </label>
                      {checked && (
                        <div className="repo-selection-fields">
                          {repoErrors[repo.id] ? (
                            <div className="repo-load-error">
                              <ErrorMessage error={repoErrors[repo.id]} t={t} />
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => loadInfo(repo.id)}
                              >
                                {t.retry}
                              </button>
                            </div>
                          ) : !info ? (
                            <span className="muted inline-flex">
                              <Spinner size={14} />
                              {t.loadingRepo}
                            </span>
                          ) : (
                            <>
                              <label className="field">
                                <span>{mode === 'create' ? t.branch : t.chooseCheckout}</span>
                                {mode === 'create' ? (
                                  selected[repo.id].useExisting ? (
                                    <select
                                      aria-label={t.branch}
                                      value={selectedBranch(repo.id)}
                                      onChange={(event) =>
                                        update(repo.id, { branch: event.target.value })
                                      }
                                      required
                                    >
                                      {existingBranches(repo.id).map((branch) => (
                                        <option key={branch}>{branch}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      aria-label={t.branch}
                                      className="mono"
                                      value={selected[repo.id].branch ?? suggested}
                                      onChange={(e) => update(repo.id, { branch: e.target.value })}
                                      required
                                    />
                                  )
                                ) : (
                                  <select
                                    aria-label={t.chooseCheckout}
                                    value={checkout(repo.id)}
                                    onChange={(e) =>
                                      update(repo.id, { worktreePath: e.target.value })
                                    }
                                    required
                                  >
                                    <option value="" disabled>
                                      {t.chooseCheckout}
                                    </option>
                                    {info.worktrees.map((tree) => (
                                      <option
                                        key={tree.path}
                                        value={tree.path}
                                        disabled={!available(tree)}
                                      >
                                        {tree.branch || 'HEAD'} · {tree.path}
                                        {available(tree) ? '' : ` (${t.checkoutInUse})`}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </label>
                              <label className="field">
                                <span>{t.base}</span>
                                <select
                                  aria-label={t.base}
                                  value={selected[repo.id].baseRef || info.defaultBranch}
                                  onChange={(e) => update(repo.id, { baseRef: e.target.value })}
                                >
                                  {[...new Set([info.defaultBranch, ...info.branches, 'HEAD'])].map(
                                    (branch) => (
                                      <option key={branch}>{branch}</option>
                                    ),
                                  )}
                                </select>
                              </label>
                              {mode === 'create' && (
                                <label
                                  className="existing-branch-toggle"
                                  title={
                                    existingBranches(repo.id).length
                                      ? t.useExistingBranch
                                      : t.noUnusedBranch
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={`${t.useExistingBranch}: ${repo.name}`}
                                    checked={!!selected[repo.id].useExisting}
                                    disabled={!existingBranches(repo.id).length}
                                    onChange={(event) =>
                                      update(repo.id, {
                                        useExisting: event.target.checked,
                                        branch: undefined,
                                      })
                                    }
                                  />
                                  <span>{t.useExistingBranch}</span>
                                </label>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <label className="field">
            <span>
              {t.taskDescription} <small>{t.optional}</small>
            </span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.taskDescriptionPlaceholder}
              maxLength={6000}
            />
          </label>
          <p className="form-hint">
            <CheckCheck size={15} />
            {mode === 'create' ? t.taskCreateHint : t.taskAttachHint}
          </p>
          <ErrorMessage {...{ error, t }} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              !title.trim() ||
              !chosen.length ||
              chosen.some(
                (id) =>
                  !information[id] ||
                  (mode === 'attach' && !checkout(id)) ||
                  (mode === 'create' && selected[id].useExisting && !selectedBranch(id)),
              )
            }
          >
            {busy ? <Spinner /> : <ArrowRight size={16} />}
            {busy ? t.creating : mode === 'create' ? t.createTask : t.attachTask}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function RepositorySetDialog({
  t,
  state,
  onClose,
  onChanged,
  notify,
}: Common & { state: State }) {
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/sets', { method: 'POST', body: { name, repositoryIds: selected } });
      await onChanged();
      notify(t.saved);
      onClose();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t.newSet} subtitle={t.setBody} {...{ t, onClose, busy }}>
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label className="field">
            <span>{t.setName}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.setNamePlaceholder}
              required
              maxLength={120}
            />
          </label>
          <div className="repo-selections">
            {state.repositories.map((repo) => (
              <label className="repo-selection-head" key={repo.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(repo.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, repo.id] : old.filter((id) => id !== repo.id),
                    )
                  }
                />
                <FolderGit2 size={17} />
                <strong>{repo.name}</strong>
              </label>
            ))}
          </div>
          <ErrorMessage {...{ error, t }} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button className="button primary" disabled={busy || !name.trim() || !selected.length}>
            {busy ? <Spinner /> : <Check size={16} />}
            {t.saveSet}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function LinkPrDialog({
  t,
  task,
  binding,
  onClose,
  onChanged,
  notify,
}: Common & { task: Task; binding: Binding }) {
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api(`/tasks/${task.id}/pr/${binding.id}`, {
        method: 'POST',
        body: { url: url.trim() },
      });
      await onChanged();
      notify(t.prLinked);
      onClose();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t.linkPr} subtitle={t.prHint} {...{ t, onClose, busy }}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>GitHub Pull Request</span>
            <input
              type="url"
              placeholder={t.prPlaceholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </label>
          <ErrorMessage {...{ error, t }} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button className="button primary" disabled={busy || !url.trim()}>
            {busy ? <Spinner /> : <Link2 size={16} />}
            {t.addPr}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function HandoffDialog({
  t,
  task,
  locale,
  onClose,
  notify,
}: Omit<Common, 'onChanged'> & { task: Task; locale: Locale }) {
  const [markdown, setMarkdown] = useState(''),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    api<{ markdown: string }>(`/tasks/${task.id}/handoff?locale=${locale}`)
      .then((result) => {
        if (alive) setMarkdown(result.markdown);
      })
      .catch((error) => {
        if (alive) setError(error);
      });
    return () => {
      alive = false;
    };
  }, [task.id, locale]);
  async function copy() {
    try {
      await copyText(markdown);
      notify(t.copied);
    } catch {
      try {
        if (await download(`tandem-${task.id.slice(0, 8)}.md`, markdown)) notify(t.downloaded);
      } catch (error) {
        setError(error);
      }
    }
  }
  return (
    <Modal title={t.handoffTitle} subtitle={t.handoffBody} {...{ t, onClose }} wide>
      <div className="modal-body handoff-body">
        <div className="handoff-heading">
          <span className="handoff-file">
            <ArrowDownToLine size={15} />
            {taskTitle(task, locale)}.md
          </span>
          <span>MARKDOWN</span>
        </div>
        {error ? (
          <ErrorMessage {...{ error, t }} />
        ) : !markdown ? (
          <div className="loading-inline">
            <Spinner />
            {t.loading}
          </div>
        ) : (
          <pre className="handoff-preview">{markdown}</pre>
        )}
        <p className="form-hint">{t.handoffNote}</p>
      </div>
      <footer className="modal-footer">
        <button
          className="button secondary"
          disabled={!markdown}
          onClick={async () => {
            try {
              if (await download(`tandem-${task.id.slice(0, 8)}.md`, markdown))
                notify(t.downloaded);
            } catch (error) {
              setError(error);
            }
          }}
        >
          <ArrowDownToLine size={16} />
          {t.downloadMarkdown}
        </button>
        <button className="button primary" disabled={!markdown} onClick={copy}>
          <Copy size={16} />
          {t.copyMarkdown}
        </button>
      </footer>
    </Modal>
  );
}

export function RenameDialog({
  t,
  task,
  locale,
  onClose,
  onChanged,
  notify,
}: Common & { task: Task; locale: Locale }) {
  const [title, setTitle] = useState(taskTitle(task, locale)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: { title, expectedRevision: task.revision },
      });
      await onChanged();
      notify(t.saved);
      onClose();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t.renameTask} {...{ t, onClose, busy }}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="field">
            <span>{t.nameLabel}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <ErrorMessage {...{ error, t }} />
        </div>
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            {busy && <Spinner />}
            {t.save}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function CommandDialog({
  t,
  locale,
  state,
  onClose,
  onSelect,
  onCreate,
  onRepository,
}: {
  t: Messages;
  locale: Locale;
  state: State;
  onClose: () => void;
  onSelect: (task: Task) => void;
  onCreate: () => void;
  onRepository: () => void;
}) {
  const [query, setQuery] = useState('');
  const resultsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const matches = state.tasks
    .filter((task) => matchesTask(task, state.repositories, query))
    .sort(
      (a, b) =>
        Number(!!a.archivedAt) - Number(!!b.archivedAt) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 8);
  return (
    <Modal title={t.searchCommand} {...{ t, onClose }} className="command-modal">
      <div className="command-search">
        <Search size={19} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.search}
          aria-label={t.search}
          aria-describedby={helpId}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            const buttons = resultsRef.current?.querySelectorAll<HTMLButtonElement>('button');
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              buttons?.[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              buttons?.[0]?.click();
            }
          }}
        />
      </div>
      <p className="command-help" id={helpId}>
        {t.commandHelp}
      </p>
      <div
        className="command-results"
        ref={resultsRef}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp'].includes(event.key))
            return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = index + (event.key === 'ArrowDown' ? 1 : -1);
          if (next < 0 || next >= buttons.length) inputRef.current?.focus();
          else buttons[next].focus();
        }}
      >
        {!query.trim() && (
          <>
            <span className="eyebrow">{t.quickActions}</span>
            <button onClick={onCreate}>
              <Plus size={17} />
              {t.newTask}
            </button>
            <button onClick={onRepository}>
              <FolderGit2 size={17} />
              {t.addRepo}
            </button>
          </>
        )}
        <span className="eyebrow">{t.tasks}</span>
        {matches.length ? (
          matches.map((task) => (
            <button key={task.id} onClick={() => onSelect(task)}>
              <span className={`status-dot ${task.status}`} />
              <span>{taskTitle(task, locale)}</span>
              {task.archivedAt && <small>{t.archive}</small>}
              <ArrowRight size={15} />
            </button>
          ))
        ) : (
          <p className="muted">{t.noCommands}</p>
        )}
      </div>
    </Modal>
  );
}
