import { z } from 'zod';

const id = z.string().uuid();
const timestamp = z.string().datetime();
const repo = z.object({
  id,
  name: z.string(),
  path: z.string(),
  commonDir: z.string(),
  defaultBranch: z.string(),
  remote: z.string().nullable(),
  color: z.string(),
  createdAt: timestamp,
  demo: z.boolean().optional(),
});
const pr = z.object({
  id,
  url: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  state: z.enum(['unknown', 'open', 'draft', 'merged', 'closed']),
  title: z.string().optional(),
  checkedAt: timestamp.optional(),
  error: z.string().optional(),
});
const binding = z.object({
  id,
  repositoryId: id,
  worktreePath: z.string(),
  branch: z.string(),
  baseRef: z.string(),
  baseSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  ownership: z.enum(['created', 'attached']),
  pullRequests: z.array(pr),
});
const task = z.object({
  id,
  revision: z.number().int().nonnegative().default(0),
  title: z.string(),
  titleEn: z.string().optional(),
  description: z.string(),
  descriptionEn: z.string().optional(),
  status: z.enum(['active', 'review', 'done']),
  bindings: z.array(binding),
  checklist: z.array(
    z.object({ id, text: z.string(), done: z.boolean(), textEn: z.string().optional() }),
  ),
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: timestamp.nullable(),
  operationId: id,
  demo: z.boolean().optional(),
});
const operation = z.object({
  id,
  requestSignature: z.string().optional(),
  taskId: id,
  title: z.string(),
  state: z.enum(['creating', 'failed', 'completed']),
  createdAt: timestamp,
  resources: z.array(
    z.object({
      repositoryId: id,
      path: z.string(),
      branch: z.string(),
      baseSha: z.string(),
      created: z.boolean(),
      branchCreated: z.boolean().optional(),
      startSha: z.string().optional(),
      cleaned: z.boolean().optional(),
    }),
  ),
  error: z.string().optional(),
});

const currentStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    repositories: z.array(repo),
    tasks: z.array(task),
    repoSets: z.array(z.object({ id, name: z.string(), repositoryIds: z.array(id) })),
    operations: z.array(operation),
    demoLoaded: z.boolean(),
  })
  .superRefine((state, context) => {
    const repositories = new Set(state.repositories.map((repo) => repo.id));
    for (const task of state.tasks) {
      if (task.bindings.some((binding) => !repositories.has(binding.repositoryId)))
        context.addIssue({
          code: 'custom',
          message: 'Missing repository binding',
          path: ['tasks'],
        });
    }
    for (const key of ['repositories', 'tasks', 'repoSets', 'operations'] as const) {
      if (new Set(state[key].map((value) => value.id)).size !== state[key].length)
        context.addIssue({ code: 'custom', message: 'Duplicate identifiers', path: [key] });
    }
  });

export const stateSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1)
    return { ...value, schemaVersion: 2 };
  return value;
}, currentStateSchema);
