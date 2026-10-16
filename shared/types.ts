export type Locale = 'zh-CN' | 'en';
export type TaskStatus = 'active' | 'review' | 'done';
export interface Repository {
  id: string;
  name: string;
  path: string;
  commonDir: string;
  defaultBranch: string;
  remote: string | null;
  color: string;
  createdAt: string;
  demo?: boolean;
}
export interface PullRequest {
  id: string;
  url: string;
  owner: string;
  repo: string;
  number: number;
  state: 'unknown' | 'open' | 'draft' | 'merged' | 'closed';
  title?: string;
  checkedAt?: string;
  error?: string;
}
export interface Binding {
  id: string;
  repositoryId: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  baseSha: string;
  ownership: 'created' | 'attached';
  pullRequests: PullRequest[];
}
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  textEn?: string;
}
export interface Task {
  id: string;
  revision: number;
  title: string;
  titleEn?: string;
  description: string;
  descriptionEn?: string;
  status: TaskStatus;
  bindings: Binding[];
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  operationId: string;
  demo?: boolean;
}
export interface RepoSet {
  id: string;
  name: string;
  repositoryIds: string[];
}
export interface Operation {
  id: string;
  requestSignature?: string;
  taskId: string;
  title: string;
  state: 'creating' | 'failed' | 'completed';
  createdAt: string;
  resources: {
    repositoryId: string;
    path: string;
    branch: string;
    baseSha: string;
    created: boolean;
    branchCreated?: boolean;
    startSha?: string;
    cleaned?: boolean;
  }[];
  error?: string;
}
export interface State {
  schemaVersion: 2;
  repositories: Repository[];
  tasks: Task[];
  repoSets: RepoSet[];
  operations: Operation[];
  demoLoaded: boolean;
}
export interface Worktree {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  locked: boolean;
}
export interface ChangedFile {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
  untracked: boolean;
}
export interface BindingStatus {
  bindingId: string;
  branch: string;
  head: string;
  files: ChangedFile[];
  branchFiles: { path: string; status: string; originalPath?: string }[];
  added: number;
  removed: number;
  ahead: number | null;
  behind: number | null;
  branchDrift: boolean;
  error?: string;
}
export interface TaskDetail {
  task: Task;
  statuses: BindingStatus[];
}
export interface DiffResult {
  text: string;
  binary: boolean;
  truncated: boolean;
}
export interface CreateTaskInput {
  title: string;
  description?: string;
  operationId: string;
  repositories: {
    repositoryId: string;
    mode: 'create' | 'existing' | 'attach';
    branch: string;
    baseRef: string;
    worktreePath?: string;
  }[];
}
export interface ApiError {
  code: string;
  details?: string;
}
