import { APP_VERSION } from '../shared/version';
import { readLocal, writeLocal } from './storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  FolderGit2,
  Layers3,
  ListTodo,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import type { Binding, Locale, State, Task, TaskStatus } from '../shared/types';
import type { DesktopAction } from '../shared/desktop';
import { api } from './api';
import { ErrorMessage, Logo, Modal, Spinner, Toast } from './components';
import { messages } from './i18n';
import { matchesTask } from './task-search';
import {
  AddRepositoryDialog,
  CommandDialog,
  CreateTaskDialog,
  HandoffDialog,
  LinkPrDialog,
  RenameDialog,
  RepositorySetDialog,
} from './dialogs';
import { TaskDetail } from './TaskDetail';
import { RepositoriesPage, TaskRow, Welcome } from './panels';
import { SettingsDialog } from './SettingsDialog';
import { hasUnsavedNotes } from './useNoteDraft';

type View = 'tasks' | 'repositories' | 'archive';
type Dialog =
  | { type: 'repository' | 'set' | 'guide' | 'command' | 'settings' }
  | { type: 'task'; repositoryIds?: string[] }
  | { type: 'handoff' | 'rename'; task: Task }
  | { type: 'pr'; task: Task; binding: Binding };
const initialState: State = {
  schemaVersion: 2,
  repositories: [],
  tasks: [],
  repoSets: [],
  operations: [],
  demoLoaded: false,
};

export default function App() {
  const [locale, setLocale] = useState<Locale>(() =>
    readLocal('tandem.locale') === 'en' ? 'en' : 'zh-CN',
  );
  const t = messages(locale);
  const [state, setState] = useState<State>(initialState),
    [loading, setLoading] = useState(true),
    [connected, setConnected] = useState(false);
  const [error, setError] = useState<unknown>(),
    [view, setView] = useState<View>('tasks');
  const [selectedId, setSelectedId] = useState(() => readLocal('tandem.selected') || '');
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [sort, setSort] = useState<'updated' | 'created' | 'name'>('updated'),
    [repoSetId, setRepoSetId] = useState('');
  const [dialog, setDialog] = useState<Dialog>(),
    [toast, setToast] = useState(''),
    [revision, setRevision] = useState(0),
    [demoBusy, setDemoBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    stateRequest = useRef(0);
  const notify = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);
  const reload = useCallback(async () => {
    const version = ++stateRequest.current;
    try {
      const next = await api<State>('/state');
      if (version === stateRequest.current) {
        setState(next);
        setConnected(true);
        setError(undefined);
      }
    } catch (error) {
      if (version === stateRequest.current) {
        setError(error);
        setConnected(false);
      }
    } finally {
      if (version === stateRequest.current) setLoading(false);
    }
  }, []);
  const onChanged = useCallback(async () => {
    await reload();
    setRevision((value) => value + 1);
  }, [reload]);
  useEffect(() => {
    reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 30000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    writeLocal('tandem.locale', locale);
    setToast('');
    document.documentElement.lang = locale;
    document.title = locale === 'zh-CN' ? '同序 · Tandem' : 'Tandem';
    void window.tandem?.savePreferences({ locale }).catch(setError);
  }, [locale]);
  useEffect(() => {
    if (selectedId) {
      writeLocal('tandem.selected', selectedId);
      void window.tandem?.savePreferences({ selectedTaskId: selectedId }).catch(setError);
    }
  }, [selectedId]);
  useEffect(() => {
    const actions: Record<DesktopAction, Dialog['type']> = {
      'new-task': 'task',
      'connect-repository': 'repository',
      search: 'command',
      settings: 'settings',
      guide: 'guide',
    };
    const stopAction = window.tandem?.onAction((action) =>
      setDialog({ type: actions[action] } as Dialog),
    );
    const stopLocale = window.tandem?.onLocale(setLocale);
    return () => {
      stopAction?.();
      stopLocale?.();
    };
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog({ type: 'command' });
      }
      if (
        event.key.toLowerCase() === 'n' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') &&
        !dialog
      ) {
        event.preventDefault();
        setDialog({ type: 'task' });
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [dialog]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (hasUnsavedNotes()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);

  const active = state.tasks.filter((task) => !task.archivedAt);
  const repoSet = state.repoSets.find((set) => set.id === repoSetId);
  const list = state.tasks
    .filter(
      (task) =>
        (view === 'archive' ? !!task.archivedAt : !task.archivedAt) &&
        (filter === 'all' || task.status === filter) &&
        (!repoSet ||
          task.bindings.some((binding) => repoSet.repositoryIds.includes(binding.repositoryId))) &&
        matchesTask(task, state.repositories, query),
    )
    .sort((a, b) =>
      sort === 'name'
        ? (locale === 'en' ? a.titleEn || a.title : a.title).localeCompare(
            locale === 'en' ? b.titleEn || b.title : b.title,
            locale,
          )
        : sort === 'created'
          ? b.createdAt.localeCompare(a.createdAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const selected = list.find((task) => task.id === selectedId) || list[0];
  function navigate(next: View) {
    setView(next);
    setQuery('');
    setFilter('all');
    setRepoSetId('');
  }
  function selectTask(task: Task) {
    navigate(task.archivedAt ? 'archive' : 'tasks');
    setSelectedId(task.id);
    setDialog(undefined);
  }
  async function demo() {
    setDemoBusy(true);
    setError(undefined);
    try {
      const result = await api<State>('/demo', { method: 'POST' });
      setState(result);
      setSelectedId(result.tasks.find((task) => task.demo)?.id || '');
      setConnected(true);
    } catch (error) {
      setError(error);
    } finally {
      setDemoBusy(false);
    }
  }
  const common = { t, onClose: () => setDialog(undefined), onChanged, notify };
  const failed = state.operations.filter(
    (operation) =>
      operation.state === 'failed' && operation.resources.some((resource) => !resource.cleaned),
  );
  const ready = !loading && connected;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label={`${t.brand} · ${t.tasks}`}
          onClick={(event) => {
            event.preventDefault();
            navigate('tasks');
          }}
        >
          <Logo />
          <strong>{t.brand}</strong>
          <small>{locale === 'zh-CN' ? 'Tandem' : ''}</small>
        </a>
        <button className="sidebar-search" onClick={() => setDialog({ type: 'command' })}>
          <Search size={15} />
          <span>{t.search}</span>
          <kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>
        <nav className="main-nav" aria-label={t.workspace}>
          <button
            aria-label={t.tasks}
            className={view === 'tasks' && !repoSetId ? 'active' : ''}
            onClick={() => navigate('tasks')}
          >
            <ListTodo size={18} />
            <span>{t.tasks}</span>
            <b>{active.length}</b>
          </button>
          <button
            aria-label={t.repositories}
            className={view === 'repositories' ? 'active' : ''}
            onClick={() => navigate('repositories')}
          >
            <FolderGit2 size={18} />
            <span>{t.repositories}</span>
            <b>{state.repositories.length}</b>
          </button>
          <button
            aria-label={t.archive}
            className={view === 'archive' ? 'active' : ''}
            onClick={() => navigate('archive')}
          >
            <Archive size={18} />
            <span>{t.archive}</span>
            <b>{state.tasks.filter((task) => task.archivedAt).length}</b>
          </button>
        </nav>
        <section className="sidebar-sets">
          <div className="nav-label">
            <span>{t.collections}</span>
            <button
              aria-label={t.newSet}
              title={t.newSet}
              onClick={() =>
                setDialog(state.repositories.length ? { type: 'set' } : { type: 'repository' })
              }
            >
              <Plus size={14} />
            </button>
          </div>
          {state.repoSets.length ? (
            state.repoSets.map((set) => (
              <div className={`sidebar-set ${set.id === repoSetId ? 'selected' : ''}`} key={set.id}>
                <button
                  title={t.filterSet}
                  onClick={() => {
                    navigate('tasks');
                    setRepoSetId(set.id);
                  }}
                >
                  <Layers3 size={15} />
                  <span>{set.name}</span>
                </button>
                <button
                  className="set-create"
                  title={t.newTask}
                  aria-label={`${t.newTask}: ${set.name}`}
                  onClick={() => setDialog({ type: 'task', repositoryIds: set.repositoryIds })}
                >
                  <Plus size={13} />
                </button>
              </div>
            ))
          ) : (
            <p className="sidebar-empty">{t.noSets}</p>
          )}
        </section>
        <div className="sidebar-bottom">
          <div className={`connection ${connected ? '' : 'offline'}`}>
            <i />
            <span>{connected ? t.localConnected : t.reconnecting}</span>
          </div>
          <button className="guide-button" onClick={() => setDialog({ type: 'guide' })}>
            <CircleHelp size={16} />
            <span>{t.guide}</span>
          </button>
          <button className="guide-button" onClick={() => setDialog({ type: 'settings' })}>
            <Settings2 size={16} />
            <span>{t.settings}</span>
          </button>
          <div className="sidebar-footer">
            <div className="locale-toggle" aria-label={t.language}>
              <button
                className={locale === 'zh-CN' ? 'active' : ''}
                onClick={() => setLocale('zh-CN')}
                lang="zh-CN"
              >
                中文
              </button>
              <button
                className={locale === 'en' ? 'active' : ''}
                onClick={() => setLocale('en')}
                lang="en"
              >
                EN
              </button>
            </div>
            <span>{APP_VERSION}</span>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <Monitor size={14} />
            <span>{t.workspace}</span>
            <ChevronRight size={12} />
            <strong>
              {view === 'tasks' ? t.tasks : view === 'archive' ? t.archive : t.repositories}
            </strong>
          </div>
          <button
            className="icon-button"
            aria-label={t.refreshAll}
            title={t.refreshAll}
            onClick={onChanged}
            disabled={loading}
          >
            <RefreshCw size={15} />
          </button>
        </header>
        <div className="main-content">
          {loading ? (
            <div className="initial-loading">
              <Spinner />
              <p>{t.loading}</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="global-error">
                  <ErrorMessage {...{ error, t }} />
                  <button className="button secondary" onClick={reload}>
                    {t.retry}
                  </button>
                </div>
              )}
              {failed.map((operation) => (
                <div className="recovery-banner" key={operation.id}>
                  <div>
                    <strong>{t.recoveryTitle}</strong>
                    <p>
                      {operation.title} · {t.recoveryBody}
                    </p>
                  </div>
                  <button
                    className="button secondary small-button"
                    onClick={async () => {
                      try {
                        await api(`/operations/${operation.id}/recover`, { method: 'POST' });
                        await onChanged();
                        notify(t.recoveryDone);
                      } catch (error) {
                        setError(error);
                      }
                    }}
                  >
                    {t.recover}
                  </button>
                </div>
              ))}
              {!state.demoLoaded && state.repositories.some((repo) => repo.demo) && (
                <div className="sample-banner">
                  <span>{t.sampleIncomplete}</span>
                  <button disabled={demoBusy} onClick={demo}>
                    {t.resumeSample}
                  </button>
                </div>
              )}
              {view === 'repositories' ? (
                <RepositoriesPage
                  {...{ state, t, onChanged, notify }}
                  onNewTask={(id) => setDialog({ type: 'task', repositoryIds: [id] })}
                  onAdd={() => setDialog({ type: 'repository' })}
                  onSet={() => setDialog({ type: 'set' })}
                />
              ) : !state.tasks.length && !state.repositories.length && view === 'tasks' ? (
                <Welcome
                  {...{ t, demoBusy }}
                  onDemo={demo}
                  onConnect={() => setDialog({ type: 'repository' })}
                />
              ) : (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>
                        {view === 'archive' ? t.archiveTitle : t.title}
                        <span className="heading-count">
                          {view === 'archive'
                            ? state.tasks.filter((task) => task.archivedAt).length
                            : active.length}
                        </span>
                      </h1>
                      {view === 'archive' && <p>{t.archiveSubtitle}</p>}
                    </div>
                    <button
                      className="button primary"
                      disabled={!ready}
                      onClick={() => setDialog({ type: 'task' })}
                    >
                      <Plus size={16} />
                      {t.newTask}
                    </button>
                  </div>
                  {view === 'tasks' &&
                    state.demoLoaded &&
                    state.tasks.every((task) => task.demo) && (
                      <div className="sample-banner">
                        <span className="sample-badge">{t.sample}</span>
                        <span>{t.sampleBanner}</span>
                        <button onClick={() => setDialog({ type: 'repository' })}>
                          {t.connectOwn}
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  <div className="tasks-toolbar">
                    <div className="filter-tabs" aria-label={t.tasks}>
                      {(['all', 'active', 'review', 'done'] as const).map((value) => (
                        <button
                          key={value}
                          className={filter === value ? 'selected' : ''}
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                        >
                          {value === 'all' ? t.all : t[value]}
                        </button>
                      ))}
                    </div>
                    <div className="toolbar-right">
                      <select
                        className="sort-select"
                        value={sort}
                        onChange={(event) => setSort(event.target.value as typeof sort)}
                        aria-label={t.sort}
                      >
                        <option value="updated">{t.sortUpdated}</option>
                        <option value="created">{t.sortCreated}</option>
                        <option value="name">{t.sortName}</option>
                      </select>
                      <div className="search-field">
                        <Search size={15} />
                        <input
                          placeholder={t.search}
                          aria-label={t.search}
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                        {query && (
                          <button
                            className="icon-button"
                            aria-label={t.close}
                            onClick={() => setQuery('')}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {repoSet && (
                    <div className="active-filter">
                      <Layers3 size={13} />
                      {repoSet.name}
                      <button
                        className="icon-button"
                        aria-label={t.clearFilter}
                        onClick={() => setRepoSetId('')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  {list.length ? (
                    <div className="task-workspace">
                      <div className="task-list" aria-label={t.taskList}>
                        <div className="task-list-caption">
                          {t.taskList}
                          <span>{list.length}</span>
                        </div>
                        {list.map((task) => (
                          <TaskRow
                            key={task.id}
                            {...{ task, state, t, locale }}
                            selected={task.id === selected?.id}
                            onClick={() => setSelectedId(task.id)}
                          />
                        ))}
                        <button
                          className="list-new-task"
                          onClick={() => setDialog({ type: 'task' })}
                        >
                          <Plus size={15} />
                          {t.newTask}
                          <kbd>N</kbd>
                        </button>
                      </div>
                      {selected && (
                        <TaskDetail
                          key={selected.id}
                          task={selected}
                          {...{ state, locale, t, revision, onChanged, notify }}
                          onHandoff={() => setDialog({ type: 'handoff', task: selected })}
                          onRename={() => setDialog({ type: 'rename', task: selected })}
                          onPr={(binding) => setDialog({ type: 'pr', task: selected, binding })}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Layers3 size={30} />
                      <h2>
                        {view === 'archive' && !query
                          ? t.archiveEmpty
                          : !active.length && !query
                            ? t.emptyTasksTitle
                            : t.noResults}
                      </h2>
                      <p>
                        {view === 'archive' && !query
                          ? t.archiveEmptyBody
                          : !active.length && !query
                            ? t.emptyTasksBody
                            : t.noResultsBody}
                      </p>
                      {view === 'tasks' && (
                        <button
                          className="button secondary"
                          onClick={() => setDialog({ type: 'task' })}
                        >
                          <Plus size={15} />
                          {t.newTask}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
      {dialog?.type === 'repository' && <AddRepositoryDialog {...common} />}
      {dialog?.type === 'task' && (
        <CreateTaskDialog
          {...common}
          state={state}
          preselected={dialog.repositoryIds}
          onCreated={selectTask}
          onAddRepository={() => setDialog({ type: 'repository' })}
        />
      )}
      {dialog?.type === 'set' && <RepositorySetDialog {...common} state={state} />}
      {dialog?.type === 'pr' && (
        <LinkPrDialog
          {...common}
          task={state.tasks.find((task) => task.id === dialog.task.id) || dialog.task}
          binding={dialog.binding}
        />
      )}
      {dialog?.type === 'handoff' && (
        <HandoffDialog {...common} task={dialog.task} locale={locale} />
      )}
      {dialog?.type === 'rename' && <RenameDialog {...common} task={dialog.task} locale={locale} />}
      {dialog?.type === 'settings' && (
        <SettingsDialog
          {...{ t, locale }}
          onLocale={setLocale}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.type === 'command' && (
        <CommandDialog
          {...{ t, locale, state }}
          onClose={() => setDialog(undefined)}
          onSelect={selectTask}
          onCreate={() => setDialog({ type: 'task' })}
          onRepository={() => setDialog({ type: 'repository' })}
        />
      )}
      {dialog?.type === 'guide' && (
        <Modal title={t.guideTitle} t={t} onClose={() => setDialog(undefined)}>
          <div className="modal-body guide-content">
            {[t.guideOne, t.guideTwo, t.guideThree, t.guideFour].map((line, index) => (
              <div key={line}>
                <span>{index + 1}</span>
                <p>{line}</p>
              </div>
            ))}
            <div className="guide-shortcut">
              <kbd>Ctrl / ⌘ K</kbd>
              {t.keyboardHint}
            </div>
          </div>
          <footer className="modal-footer">
            <button className="button secondary" onClick={() => setDialog(undefined)}>
              <Check size={15} />
              {t.close}
            </button>
          </footer>
        </Modal>
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}
