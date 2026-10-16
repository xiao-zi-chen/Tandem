import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff } from '../src/unified-diff';
import { matchesTask } from '../src/task-search';
import type { Repository, Task } from '../shared/types';

test('diff content resembling file headers is visible with correct line numbers', () => {
  const rows = parseUnifiedDiff(
    [
      'diff --git a/notes.txt b/notes.txt',
      'index abc123..def456 100644',
      '--- a/notes.txt',
      '+++ b/notes.txt',
      '@@ -4,2 +4,2 @@',
      '--- old heading',
      '+++ new heading',
      ' unchanged',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    rows.map(({ line, type, old, next }) => ({ line, type, old, next })),
    [
      { line: '@@ -4,2 +4,2 @@', type: 'hunk', old: '', next: '' },
      { line: '-- old heading', type: 'remove', old: '4', next: '' },
      { line: '++ new heading', type: 'add', old: '', next: '4' },
      { line: 'unchanged', type: 'context', old: '5', next: '5' },
    ],
  );
});

test('hunks reset numbering and missing-newline markers do not consume a source line', () => {
  const rows = parseUnifiedDiff(
    '@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n@@ -10,0 +11,2 @@\n+first\n+second\n',
  );
  assert.deepEqual(
    rows.filter((r) => r.type === 'add').map((r) => r.next),
    ['1', '11', '12'],
  );
  assert.ok(rows.filter((r) => r.type === 'meta').every((r) => !r.old && !r.next));
  assert.deepEqual(parseUnifiedDiff(''), []);
});

test('rename metadata remains visible and a new file resets header parsing', () => {
  const rows = parseUnifiedDiff(
    'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
  );
  assert.equal(rows[1].line, 'rename from old.txt');
  assert.equal(rows[2].line, 'rename to new.txt');
  assert.equal(rows.filter((r) => r.type === 'add').length, 1);
  assert.equal(rows.filter((r) => r.type === 'remove').length, 1);
});

test('task search combines bilingual titles, repositories, branches and linked PRs', () => {
  const repositories: Repository[] = [
    {
      id: 'web',
      name: 'Storefront Web',
      path: '/local',
      commonDir: '/local/.git',
      defaultBranch: 'main',
      remote: null,
      color: '#fff',
      createdAt: '',
    },
  ];
  const task: Task = {
    id: 'checkout',
    revision: 0,
    title: '付款流程',
    titleEn: 'Checkout delivery',
    description: '',
    status: 'active',
    checklist: [],
    createdAt: '',
    updatedAt: '',
    archivedAt: null,
    operationId: 'create',
    bindings: [
      {
        id: 'binding',
        repositoryId: 'web',
        worktreePath: '/local',
        branch: 'feature/delivery',
        baseRef: 'main',
        baseSha: 'a',
        ownership: 'attached',
        pullRequests: [
          {
            id: 'pr',
            url: 'https://github.com/example/web/pull/123',
            owner: 'example',
            repo: 'web',
            number: 123,
            title: 'Shipping options',
            state: 'open',
          },
        ],
      },
    ],
  };
  for (const query of [
    '付款',
    '  STOREFRONT   delivery ',
    '#123 shipping',
    '＃１２３',
    'example/web/pull/123',
    '',
  ]) {
    assert.equal(matchesTask(task, repositories, query), true, query);
  }
  assert.equal(matchesTask(task, repositories, 'storefront missing'), false);
});
