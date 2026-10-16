import type { Repository, Task } from '../shared/types';

export function matchesTask(task: Task, repositories: Repository[], query: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const text = normalize(
    [
      task.title,
      task.titleEn || '',
      ...task.bindings.flatMap((binding) => [
        binding.branch,
        repositories.find((repo) => repo.id === binding.repositoryId)?.name || '',
        ...binding.pullRequests.flatMap((pr) => [pr.url, `#${pr.number}`, pr.title || '']),
      ]),
    ].join(' '),
  );
  return terms.every((term) => text.includes(term));
}
