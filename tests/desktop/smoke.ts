import { APP_VERSION } from '../../shared/version';
import assert from 'node:assert/strict';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import type { DesktopInfo } from '../../shared/desktop';

const executable =
  process.env.TANDEM_EXECUTABLE || resolve(`release/${APP_VERSION}/win-unpacked/Tandem.exe`);
assert.ok(existsSync(executable), 'Build the desktop application before running its smoke test.');
const packaged = basename(executable).toLowerCase() !== 'electron.exe';
const data = await mkdtemp(join(tmpdir(), 'tandem-native-test-'));
const env: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ),
  TANDEM_USER_DATA: data,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.TANDEM_DATA_DIR;
const screenshots = resolve('docs/screenshots-v3');
await mkdir(screenshots, { recursive: true });
const results: string[] = [];
let instance: ElectronApplication | undefined;
let info: DesktopInfo | undefined;
const launch = () =>
  electron.launch({
    executablePath: executable,
    args: packaged ? [] : ['.'],
    cwd: process.cwd(),
    env,
    timeout: 30000,
  });

try {
  instance = await launch();
  const page = await instance.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(
    page.getByRole('heading', { name: /设置工作台|Set up your workspace/ }),
  ).toBeVisible();
  assert.equal(page.url(), 'tandem://app/index.html');
  const isolated = await page.evaluate(
    () =>
      typeof (window as any).require === 'undefined' &&
      typeof (window as any).process === 'undefined',
  );
  assert.equal(isolated, true);
  const preferences = await page.evaluate(() => window.tandem!.runtime);
  assert.deepEqual(preferences, { sandboxed: true, contextIsolated: true });
  info = await page.evaluate(() => window.tandem!.info());
  assert.equal(info.packaged, packaged);
  assert.equal(info.version, APP_VERSION);
  assert.ok(info.gitVersion?.startsWith('git version'));
  assert.ok(info.dataDirectory.startsWith(data));
  results.push(
    'Native executable, isolated renderer, stable application origin and private data directory',
  );

  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Open sample workspace' }).click();
  await expect(page.locator('.task-card')).toHaveCount(3, { timeout: 30000 });
  await expect(page.locator('.task-detail h2')).toHaveText('Add annual billing');
  await expect(page.locator('.repo-change-summary').first()).toContainText('2 uncommitted files');
  await page.screenshot({ path: join(screenshots, 'desktop-workspace-en.png') });
  results.push('Creates real multi-repository sample worktrees and reads their actual Git status');

  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog').getByPlaceholder('Find a task…');
  await search.fill('fieldnotes-web annual');
  await search.press('ArrowDown');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Add annual billing' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.task-detail h2')).toHaveText('Add annual billing');
  results.push('Native search shortcut finds a task across repositories with keyboard navigation');

  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.diff-table')).toContainText('BillingCycle');
  await page.getByLabel('Filter files…').fill('billing-toggle');
  await expect(page.locator('.diff-table')).toContainText('billingOptions');
  await page.getByLabel('Filter files…').fill('');
  await page.locator('.changes-repos').getByRole('button', { name: 'fieldnotes-api' }).click();
  await expect(page.locator('.diff-table')).toContainText('ANNUAL_BILLABLE_MONTHS');
  await page.screenshot({ path: join(screenshots, 'desktop-changes-en.png') });
  results.push('Working, untracked and staged diffs with file filtering');

  await page.getByRole('button', { name: 'Export handoff' }).click();
  await expect(page.locator('.handoff-preview')).toContainText('Linked pull requests');
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  const copied = await instance.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(copied, /Add annual billing/);
  const exportFile = join(data, 'handoff.md');
  await instance.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, exportFile);
  await page.getByRole('button', { name: 'Download .md' }).click();
  await expect
    .poll(async () => {
      try {
        return await readFile(exportFile, 'utf8');
      } catch {
        return '';
      }
    })
    .toContain('Add annual billing');
  await page.screenshot({ path: join(screenshots, 'desktop-handoff-en.png') });
  await page.keyboard.press('Escape');
  results.push('Native clipboard and save-dialog IPC writes a readable Markdown file');

  await instance.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!
      .items.find((item) => item.label === 'File')!
      .submenu!.items.find((item) => item.label === 'Connect repository…')!
      .click(),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  const samplePath = join(info.dataDirectory, 'sample-project', 'web');
  await instance.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, samplePath);
  await page.getByRole('button', { name: 'Browse…' }).click();
  await expect(page.getByLabel('Repository path')).toHaveValue(samplePath);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Connect repository', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  results.push('Native application menu and folder-picker IPC connect existing repositories');

  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByLabel('Task notes').fill('Keep this note while cancelling a workspace switch.');
  const otherWorkspace = join(data, 'another-workspace');
  await mkdir(otherWorkspace);
  await instance.evaluate(({ dialog, app }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox;
    dialog.showMessageBoxSync = () => 0;
    (globalThis as any).__tandemRelaunch = app.relaunch;
    (globalThis as any).__tandemRelaunchCount = 0;
    app.relaunch = () => {
      (globalThis as any).__tandemRelaunchCount++;
    };
  }, otherWorkspace);
  await page.evaluate(() => window.tandem!.switchDataDirectory());
  await expect(page.getByLabel('Task notes')).toHaveValue(
    'Keep this note while cancelling a workspace switch.',
  );
  assert.equal(
    (await page.evaluate(() => window.tandem!.info())).dataDirectory,
    info.dataDirectory,
  );
  assert.notEqual(
    JSON.parse(await readFile(join(data, 'preferences.json'), 'utf8')).dataDirectory,
    otherWorkspace,
  );
  assert.equal(await instance.evaluate(() => (globalThis as any).__tandemRelaunchCount), 0);
  await instance.evaluate(({ app }) => {
    app.relaunch = (globalThis as any).__tandemRelaunch;
  });
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  results.push(
    'Cancelling a close/workspace switch preserves the note, active service and data directory',
  );

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(APP_VERSION);
  await expect(page.getByRole('dialog')).toContainText('git version');
  await expect(page.locator('.toast')).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Downloads & release notes' })).toHaveAttribute(
    'href',
    'https://github.com/xiao-zi-chen/Tandem/releases',
  );
  await expect(page.getByRole('link', { name: 'Report an issue' })).toHaveAttribute(
    'href',
    'https://github.com/xiao-zi-chen/Tandem/issues/new/choose',
  );
  await page.screenshot({
    path: join(screenshots, 'desktop-settings-en.png'),
    mask: [page.locator('.settings-path')],
    maskColor: '#e9edf2',
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '中文', exact: true }).click();
  await page.getByRole('tab', { name: '概览', exact: true }).click();
  await page.locator('.overview-panel').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: join(screenshots, 'desktop-workspace-zh.png') });
  const menus = await instance.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()!.items.map((item) => item.label),
  );
  assert.ok(menus.includes('文件'));
  assert.ok(menus.includes('编辑'));
  await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 850),
  );
  assert.deepEqual(errors, []);
  await instance.close();
  instance = undefined;

  instance = await launch();
  const reopened = await instance.firstWindow();
  await expect(reopened.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(reopened.locator('.task-card')).toHaveCount(3);
  const size = await instance.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize(),
  );
  assert.deepEqual(size, [1280, 850]);
  results.push('Language, window size and repository/task data survive an application restart');
  console.log(
    JSON.stringify(
      {
        packagedExecutable: executable,
        version: info.version,
        passed: results.length,
        checks: results,
      },
      null,
      2,
    ),
  );
} finally {
  await instance?.close();
}
