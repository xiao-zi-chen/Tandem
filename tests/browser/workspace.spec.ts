import { test, expect } from '@playwright/test';
import { git } from '../../server/git';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });

test('first run, both languages, real Git changes and portable handoff', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '设置工作台' })).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sample workspace' }).click();
  await expect(page.locator('.task-card')).toHaveCount(3);
  await expect(page.locator('.task-detail h2')).toHaveText('Add annual billing');
  await expect(page.locator('.repo-change-summary').first()).toContainText('2 uncommitted files');
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.diff-table')).toContainText('BillingCycle');
  await page.locator('.changes-repos').getByRole('button', { name: 'fieldnotes-api' }).click();
  await expect(page.locator('.diff-layers')).toContainText('Staged');
  await expect(page.locator('.diff-table')).toContainText('ANNUAL_BILLABLE_MONTHS');
  await page.getByRole('button', { name: 'Export handoff' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.handoff-preview')).toContainText('uncommitted');
  await expect(page.locator('.handoff-preview')).not.toContainText('AppData');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .md' }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/\.md$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.locator('.task-detail h2')).toHaveText('订阅方案支持年付');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.task-card')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('creates actual multi-repo task, edits checkpoints and notes, links PR and archives safely', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('.page-heading').getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Task name')).toBeFocused();
  await dialog.getByLabel('Task name').fill('Checkout shipping options');
  await dialog.getByRole('button', { name: 'Fieldnotes', exact: true }).click();
  await expect(dialog.locator('.repo-selection.checked')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Create task workspace' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.task-detail h2')).toHaveText('Checkout shipping options');
  await expect(page.locator('.task-card')).toHaveCount(4);
  await expect(page.locator('.bound-repo')).toHaveCount(2);
  await expect(page.locator('.clean-text')).toHaveCount(2);
  await page.getByLabel('Add a checkpoint…').fill('Check delivery estimates');
  await page.getByLabel('Add a checkpoint…').press('Enter');
  await expect(page.getByLabel('Check delivery estimates')).toBeVisible();
  await page.getByLabel('Check delivery estimates').check();
  await expect(page.getByLabel('Check delivery estimates')).toBeChecked();
  await page.getByLabel('Task notes').fill('Review delivery dates with the API owner.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.locator('.bound-repo').first().getByRole('button', { name: 'Link PR' }).click();
  await page.getByLabel('GitHub Pull Request').fill('https://github.com/example/web/pull/123');
  await page.getByRole('dialog').getByRole('button', { name: 'Link PR' }).click();
  await expect(page.locator('.pr-link')).toContainText('#123');
  await expect(page.locator('.pr-link')).toContainText('Unverified');
  await page.reload();
  await expect(page.locator('.task-detail h2')).toHaveText('Checkout shipping options');
  await expect(page.getByLabel('Task notes')).toHaveValue(
    'Review delivery dates with the API owner.',
  );
  await page.getByLabel('Task status').selectOption('review');
  await page.getByRole('button', { name: 'Archive task', exact: true }).click();
  await page
    .locator('.main-nav')
    .getByRole('button', { name: /Archive/ })
    .click();
  await expect(page.locator('.task-detail h2')).toHaveText('Checkout shipping options');
  await page.getByRole('button', { name: 'Restore task', exact: true }).click();
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.locator('.main-nav').getByRole('button', { name: /Tasks/ }).click();
  await expect(page.locator('.task-card')).toHaveCount(4);
});

test('attaches existing work, keyboard search and localized failure messages', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task name').fill('Existing checkout');
  await dialog.getByRole('button', { name: /Existing work/ }).click();
  await dialog.locator('.repo-selection-head').first().getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Attach checkouts' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.task-detail h2')).toHaveText('Existing checkout');
  const bootstrap = await (await request.get('/api/bootstrap')).json();
  const state = await (
    await request.get('/api/state', { headers: { 'x-tandem-token': bootstrap.token } })
  ).json();
  expect(
    state.tasks.find((task: any) => task.title === 'Existing checkout').bindings[0].ownership,
  ).toBe('attached');
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByPlaceholder('Find a task…').fill('annual');
  await page.getByRole('dialog').getByRole('button', { name: 'Add annual billing' }).click();
  await expect(page.locator('.task-detail h2')).toHaveText('Add annual billing');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.locator('.main-nav').getByRole('button', { name: /仓库/ }).click();
  await page.locator('.page-heading').getByRole('button', { name: '连接仓库' }).click();
  await page.getByLabel('仓库路径').fill('Z:\\this-path-does-not-exist\\tandem');
  await page.getByRole('dialog').getByRole('button', { name: '连接仓库' }).click();
  await expect(page.getByRole('alert')).toContainText('在本机找不到这个路径');
  await page.keyboard.press('Escape');
});

test('narrow screens retain all core controls without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.task-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: 'Add annual billing' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Export handoff' }).click();
  await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.diff-table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('local API rejects cross-origin and unauthenticated access', async ({ request }) => {
  expect((await request.get('/api/state')).status()).toBe(403);
  expect(
    (
      await request.get('/api/bootstrap', { headers: { Origin: 'https://untrusted.example' } })
    ).status(),
  ).toBe(403);
  expect(
    (await request.post('/api/demo', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status(),
  ).toBe(403);
  const bootstrap = await (await request.get('/api/bootstrap')).json();
  const result = await request.get('/api/state', {
    headers: { 'x-tandem-token': bootstrap.token },
  });
  expect(result.status()).toBe(200);
  const failed = await request.post('/api/tasks', {
    headers: { 'x-tandem-token': bootstrap.token },
    data: { title: 'invalid' },
  });
  expect(failed.status()).toBe(400);
  expect((await failed.json()).code).toBe('VALIDATION');
});

test('retains a note draft when navigating and detects edits from another window', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  const annual = page.locator('.task-card').filter({ hasText: 'Add annual billing' });
  await annual.click();
  await page.getByLabel('Task notes').fill('My local draft remains available.');
  await page.locator('.task-card').filter({ hasText: 'Paginate search results' }).click();
  await annual.click();
  await expect(page.getByLabel('Task notes')).toHaveValue('My local draft remains available.');
  const { token } = await (await request.get('/api/bootstrap')).json();
  const headers = { 'x-tandem-token': token };
  const state = await (await request.get('/api/state', { headers })).json();
  const task = state.tasks.find((task: any) => task.titleEn === 'Add annual billing');
  const remote = await request.patch(`/api/tasks/${task.id}`, {
    headers,
    data: { description: 'Saved from a different window.', expectedRevision: task.revision },
  });
  expect(remote.status()).toBe(200);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('updated elsewhere');
  await expect(page.getByLabel('Task notes')).toHaveValue('My local draft remains available.');
  await expect(page.locator('.remote-note')).toContainText('Saved from a different window.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).not.toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Task notes')).toHaveValue('My local draft remains available.');
});

test('typing while a note save is in flight keeps the newer draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: 'Add annual billing' }).click();
  const field = page.getByLabel('Task notes');
  await field.fill('First submitted note');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route('**/api/tasks/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      observed();
      await blocked;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await requested;
  await field.fill('First submitted note, plus more typing');
  release();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('First submitted note, plus more typing');
  await page.unroute('**/api/tasks/*');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).not.toBeVisible();
});

test('language switching keeps each unsaved note draft separate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: 'Add annual billing' }).click();
  await page.getByLabel('Task notes').fill('English draft');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByLabel('任务备注').fill('中文草稿');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByLabel('Task notes')).toHaveValue('English draft');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await expect(page.getByLabel('任务备注')).toHaveValue('中文草稿');
  await page.getByRole('button', { name: '放弃草稿' }).click();
});

test('a full draft cache does not lose notes when navigating', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('tandem.note.'))
        throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  const annual = page.locator('.task-card').filter({ hasText: 'Add annual billing' });
  await annual.click();
  await page.getByLabel('Task notes').fill('Draft with unavailable browser storage');
  await expect(page.getByRole('alert')).toContainText('could not be stored');
  await page
    .locator('.main-nav')
    .getByRole('button', { name: 'Repositories', exact: true })
    .click();
  const closing = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const warning = await closing;
  expect(warning.type()).toBe('beforeunload');
  await warning.dismiss();
  expect(page.isClosed()).toBe(false);
  await page.locator('.main-nav').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: 'Paginate search results' }).click();
  await annual.click();
  await expect(page.getByLabel('Task notes')).toHaveValue('Draft with unavailable browser storage');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).not.toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('an existing unoccupied branch can be selected in the task dialog', async ({
  page,
  request,
}) => {
  const { token } = await (await request.get('/api/bootstrap')).json();
  const headers = { 'x-tandem-token': token };
  let state = await (await request.get('/api/state', { headers })).json();
  if (!state.repositories.some((repo: any) => repo.name === 'fieldnotes-web')) {
    await request.post('/api/demo', { headers });
    state = await (await request.get('/api/state', { headers })).json();
  }
  const repository = state.repositories.find((repo: any) => repo.name === 'fieldnotes-web');
  await git(repository.path, ['branch', 'feature/customer-branch', 'main']);
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('.page-heading').getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task name').fill('Resume customer branch');
  await dialog
    .locator('.repo-selection-head')
    .filter({ hasText: 'fieldnotes-web' })
    .getByRole('checkbox')
    .check();
  await dialog.getByRole('checkbox', { name: 'Use an existing branch: fieldnotes-web' }).check();
  await expect(
    dialog.locator('.repo-selection.checked').getByLabel('Branch', { exact: true }),
  ).toHaveValue('feature/customer-branch');
  await dialog.getByRole('button', { name: 'Create task workspace' }).click();
  await expect(page.locator('.task-detail h2')).toHaveText('Resume customer branch');
  await expect(page.locator('.bound-repo .branch-line')).toContainText('feature/customer-branch');
});

test('task search finds repositories and PRs and works entirely from the keyboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  const search = dialog.getByPlaceholder('Find a task…');
  await search.fill('fieldnotes-web annual');
  const annual = dialog.getByRole('button', { name: 'Add annual billing' });
  await expect(annual).toBeVisible();
  await search.press('ArrowDown');
  await expect(annual).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await search.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.task-detail h2')).toHaveText('Add annual billing');

  await page.keyboard.press('Control+k');
  await search.fill('#123');
  await search.press('Enter');
  await expect(page.locator('.task-detail h2')).toHaveText('Checkout shipping options');
  await page.locator('.search-field input').fill('  fieldnotes-web   #123  ');
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.locator('.search-field input').fill('');

  await page.keyboard.press('Control+k');
  await search.fill('no-such-task-123456');
  await search.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('a renamed file is found by its old path and header-like code stays visible', async ({
  page,
  request,
}) => {
  const { token } = await (await request.get('/api/bootstrap')).json();
  const headers = { 'x-tandem-token': token };
  const state = await (await request.get('/api/state', { headers })).json();
  const task = state.tasks.find((task: any) => task.title === 'Resume customer branch');
  const path = task.bindings[0].worktreePath;
  const original =
    ['-- old heading', ...Array.from({ length: 12 }, (_, i) => `line ${i}`)].join('\n') + '\n';
  await writeFile(join(path, 'previous-name.txt'), original);
  await git(path, ['add', 'previous-name.txt']);
  await git(path, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Add rename fixture',
  ]);
  await git(path, ['mv', 'previous-name.txt', 'current-name.txt']);
  await writeFile(
    join(path, 'current-name.txt'),
    original.replace('-- old heading', '++ new heading'),
  );
  await git(path, ['add', 'current-name.txt']);
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.locator('.task-card').filter({ hasText: 'Resume customer branch' }).click();
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.getByLabel('Filter files…').fill('previous-name');
  await expect(page.locator('.changed-file-list button')).toHaveCount(1);
  await expect(page.locator('.diff-toolbar')).toContainText('current-name.txt');
  await expect(page.locator('.diff-table .remove .line-content')).toHaveText('-- old heading');
  await expect(page.locator('.diff-table .add .line-content')).toHaveText('++ new heading');
});
