import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  FolderGit2,
  GitBranch,
  Layers3,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Locale, State, Task, Repository } from '../shared/types';
import type { Messages } from './i18n';
import { taskTitle } from './i18n';
import { ErrorMessage, Spinner } from './components';
import { api } from './api';

export function TaskRow({
  task,
  state,
  t,
  locale,
  selected,
  onClick,
}: {
  task: Task;
  state: State;
  t: Messages;
  locale: Locale;
  selected: boolean;
  onClick: () => void;
}) {
  const repos = task.bindings
    .map((binding) => state.repositories.find((repo) => repo.id === binding.repositoryId)?.name)
    .filter(Boolean);
  return (
    <button
      className={`task-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className="task-card-top">
        <span className={`task-status ${task.status}`}>
          <span className={`status-dot ${task.status}`} />
          {t[task.status]}
        </span>
        <time dateTime={task.updatedAt} title={new Date(task.updatedAt).toLocaleString(locale)}>
          {new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
            new Date(task.updatedAt),
          )}
        </time>
      </div>
      <h3>{taskTitle(task, locale)}</h3>
      <div className="task-card-branch">
        <GitBranch size={13} />
        <span>{task.bindings[0]?.branch}</span>
      </div>
      <div className="task-card-bottom">
        <span className="task-repo-names" title={repos.join(' · ')}>
          {repos.join(' · ')}
        </span>
        <span className="repo-count">{repos.length}</span>
      </div>
    </button>
  );
}

export function Welcome({
  t,
  demoBusy,
  onDemo,
  onConnect,
}: {
  t: Messages;
  demoBusy: boolean;
  onDemo: () => void;
  onConnect: () => void;
}) {
  return (
    <section className="welcome">
      <div className="welcome-heading">
        <FolderGit2 size={28} strokeWidth={1.5} />
        <h1>{t.welcomeTitle}</h1>
        <p>{t.welcomeBody}</p>
      </div>
      <div className="setup-steps">
        {[
          { icon: FolderGit2, title: t.welcomeOne, body: t.welcomeOneBody },
          { icon: GitBranch, title: t.welcomeTwo, body: t.welcomeTwoBody },
          { icon: BookOpen, title: t.welcomeThree, body: t.welcomeThreeBody },
        ].map((step, index) => (
          <div key={step.title}>
            <span className="step-number">{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="welcome-actions">
        <button className="button primary" onClick={onConnect} disabled={demoBusy}>
          <Plus size={16} />
          {t.addRepo}
        </button>
        <button className="button secondary" onClick={onDemo} disabled={demoBusy}>
          {demoBusy ? <Spinner /> : <BookOpen size={16} />} {demoBusy ? t.creating : t.trySample}
        </button>
      </div>
      <p className="welcome-sample-note">{t.sampleHint}</p>
    </section>
  );
}

export function RepositoriesPage({
  state,
  t,
  onChanged,
  notify,
  onNewTask,
  onAdd,
  onSet,
}: {
  state: State;
  t: Messages;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  onNewTask: (id: string) => void;
  onAdd: () => void;
  onSet: () => void;
}) {
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState('');
  async function disconnect(repo: Repository) {
    setBusy(repo.id);
    setError(undefined);
    try {
      await api(`/repositories/${repo.id}`, { method: 'DELETE' });
      await onChanged();
      notify(t.repoRemoved);
    } catch (error) {
      setError(error);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {t.repoTitle}
            <span className="heading-count">{state.repositories.length}</span>
          </h1>
          <p>{t.repoSubtitle}</p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} />
          {t.addRepo}
        </button>
      </div>
      <ErrorMessage {...{ error, t }} />
      {state.repositories.length ? (
        <div className="repository-table">
          <table>
            <thead>
              <tr>
                <th>{t.repoLabel}</th>
                <th>{t.defaultBase}</th>
                <th>{t.tasks}</th>
                <th>
                  <span className="sr-only">{t.repoAction}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.repositories.map((repo) => {
                const count = state.tasks.filter((task) =>
                  task.bindings.some((binding) => binding.repositoryId === repo.id),
                ).length;
                return (
                  <tr key={repo.id}>
                    <td>
                      <div className="repo-table-name">
                        <FolderGit2 size={19} />
                        <strong>{repo.name}</strong>
                        {repo.demo && <span className="sample-badge">{t.sample}</span>}
                      </div>
                      <div className="repo-path mono" title={repo.path}>
                        {repo.path}
                      </div>
                    </td>
                    <td>
                      <span className="branch-label">
                        <GitBranch size={13} />
                        {repo.defaultBranch}
                      </span>
                    </td>
                    <td>{count}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="button secondary small-button"
                          onClick={() => onNewTask(repo.id)}
                        >
                          {t.useInTask}
                          <ArrowRight size={13} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`${t.removeRepo}: ${repo.name}`}
                          title={count ? t.repoInUseHint : t.removeRepoHint}
                          disabled={!!count || busy === repo.id}
                          onClick={() => disconnect(repo)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <FolderGit2 size={30} />
          <h2>{t.noRepo}</h2>
          <button className="button secondary" onClick={onAdd}>
            {t.addRepo}
          </button>
        </div>
      )}
      <section className="sets-section">
        <div className="section-heading">
          <h2>{t.collections}</h2>
          <button
            className="button secondary small-button"
            onClick={onSet}
            disabled={!state.repositories.length}
          >
            <Plus size={14} />
            {t.newSet}
          </button>
        </div>
        <p className="muted">{t.setBody}</p>
        {state.repoSets.length ? (
          <div className="set-list">
            {state.repoSets.map((set) => (
              <div className="set-row" key={set.id}>
                <Layers3 size={17} />
                <strong>{set.name}</strong>
                <span>
                  {set.repositoryIds
                    .map((id) => state.repositories.find((repo) => repo.id === id)?.name)
                    .join(' · ')}
                </span>
                <button
                  className="icon-button"
                  aria-label={t.deleteSet}
                  onClick={async () => {
                    try {
                      await api(`/sets/${set.id}`, { method: 'DELETE' });
                      await onChanged();
                    } catch (error) {
                      setError(error);
                    }
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="sets-empty">{t.noSets}</p>
        )}
      </section>
    </>
  );
}
