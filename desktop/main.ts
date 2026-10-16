import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  session,
  clipboard,
  screen,
} from 'electron';
import { join, resolve, relative, isAbsolute, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeFile, access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { startApplication } from '../server/app';
import { stateSchema } from '../server/state-schema';
import { AppError, describeError } from '../server/errors';
import type { DesktopAction } from '../shared/desktop';
import {
  PreferenceStore,
  preferenceSchema,
  restorePreferenceBackup,
  type Preferences,
} from './preferences';
import { stateBackupInfo, restoreStateBackup } from '../server/store';
import { acquireWorkspaceLock } from '../server/workspace-lock';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tandem',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
if (process.platform === 'win32') app.setAppUserModelId('com.tandem.workspace');

if (process.env.TANDEM_USER_DATA) {
  const testDirectory = resolve(process.env.TANDEM_USER_DATA);
  mkdirSync(testDirectory, { recursive: true });
  app.setPath('userData', testDirectory);
}

const preferenceStore = new PreferenceStore(app.getPath('userData'));
let preferences: Preferences = {};
let pendingWorkspace: string | undefined;
let mainWindow: BrowserWindow | null = null;
let application: Awaited<ReturnType<typeof startApplication>> | undefined;
let closing = false;
let reopenRequested = false;
const locale = () => preferences.locale || (app.getLocale().startsWith('zh') ? 'zh-CN' : 'en');
const label = (zh: string, en: string) => (locale() === 'zh-CN' ? zh : en);

async function savePreferences(patch: Partial<Preferences>) {
  preferences = await preferenceStore.save(patch);
}

function action(name: DesktopAction) {
  mainWindow?.webContents.send('tandem:action', name);
}
function setMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: label('文件', 'File'),
      submenu: [
        {
          label: label('新建任务', 'New task'),
          accelerator: 'CmdOrCtrl+N',
          click: () => action('new-task'),
        },
        {
          label: label('连接仓库…', 'Connect repository…'),
          accelerator: 'CmdOrCtrl+O',
          click: () => action('connect-repository'),
        },
        { type: 'separator' },
        {
          label: label('设置…', 'Settings…'),
          accelerator: 'CmdOrCtrl+,',
          click: () => action('settings'),
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit', label: label('退出', 'Quit') },
      ],
    },
    {
      label: label('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: label('撤销', 'Undo') },
        { role: 'redo', label: label('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: label('剪切', 'Cut') },
        { role: 'copy', label: label('复制', 'Copy') },
        { role: 'paste', label: label('粘贴', 'Paste') },
        { role: 'selectAll', label: label('全选', 'Select all') },
      ],
    },
    {
      label: label('查看', 'View'),
      submenu: [
        {
          label: label('搜索任务', 'Search tasks'),
          accelerator: 'CmdOrCtrl+K',
          click: () => action('search'),
        },
        { role: 'reload', label: label('刷新', 'Reload') },
        { type: 'separator' },
        { role: 'resetZoom', label: label('实际大小', 'Actual size') },
        { role: 'zoomIn', label: label('放大', 'Zoom in') },
        { role: 'zoomOut', label: label('缩小', 'Zoom out') },
        { role: 'togglefullscreen', label: label('全屏', 'Full screen') },
      ],
    },
    {
      label: label('语言', 'Language'),
      submenu: (['zh-CN', 'en'] as const).map((value) => ({
        label: value === 'zh-CN' ? '简体中文' : 'English',
        type: 'radio',
        checked: locale() === value,
        click: async () => {
          await savePreferences({ locale: value });
          setMenu();
          mainWindow?.webContents.send('tandem:locale', value);
        },
      })),
    },
    {
      label: label('帮助', 'Help'),
      submenu: [
        { label: label('使用指南', 'User guide'), click: () => action('guide') },
        { label: label('关于同序', 'About Tandem'), click: () => action('settings') },
      ],
    },
  ];
  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const trustedSender = (event: Electron.IpcMainInvokeEvent) =>
  !!mainWindow &&
  event.sender === mainWindow.webContents &&
  event.senderFrame?.url.startsWith('tandem://app/');
function handle(
  name: string,
  callback: (event: Electron.IpcMainInvokeEvent, payload: unknown) => unknown,
) {
  ipcMain.handle(name, async (event, payload) => {
    if (!trustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN' } };
    try {
      return { ok: true, value: await callback(event, payload) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof z.ZodError ? { code: 'VALIDATION' } : describeError(error),
      };
    }
  });
}

function external(url: string) {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'https:' &&
      ['github.com', 'git-scm.com'].includes(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    )
      void shell.openExternal(parsed.href);
  } catch {
    /* Invalid URLs are never passed to the OS. */
  }
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (closing || !mainWindow || mainWindow.isDestroyed()) {
      reopenRequested = true;
      return;
    }
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  await app.whenReady();
  preferences = await preferenceStore.init();
  const clientDirectory = join(__dirname, '..', 'client');
  const dataDirectory = resolve(
    process.env.TANDEM_DATA_DIR ||
      preferences.dataDirectory ||
      join(app.getPath('userData'), 'data'),
  );
  application = await startApplication({
    directory: dataDirectory,
    clientDirectory,
    port: 0,
    fetcher: net.fetch as typeof fetch,
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle('tandem', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('referer');
      headers.set('origin', application!.origin);
      headers.set('sec-fetch-site', 'same-origin');
      return net.fetch(`${application!.origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        ...(request.method !== 'GET' && request.method !== 'HEAD'
          ? { body: await request.arrayBuffer() }
          : {}),
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method not allowed', { status: 405 });
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filename = resolve(clientDirectory, `.${pathname}`);
    const relativePath = relative(clientDirectory, filename);
    if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`))
      return new Response('Forbidden', { status: 403 });
    try {
      await access(filename);
      const response = await net.fetch(pathToFileURL(filename).href);
      const headers = new Headers(response.headers);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      headers.set('Content-Type', mime[extname(filename)] || 'application/octet-stream');
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  handle('tandem:preferences', () => ({
    locale: locale(),
    selectedTaskId: preferences.selectedTaskId,
  }));
  handle('tandem:preferences:save', async (_event, payload) => {
    const patch = z
      .object({
        locale: z.enum(['zh-CN', 'en']).optional(),
        selectedTaskId: z.string().uuid().optional(),
      })
      .strict()
      .parse(payload);
    await savePreferences(patch);
    if (patch.locale) setMenu();
  });
  handle('tandem:choose-repository', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: label('选择 Git 仓库', 'Select a Git repository'),
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('tandem:save-file', async (_event, payload) => {
    const request = z
      .object({
        name: z.string().regex(/^[a-zA-Z0-9._-]+\.(?:md|code-workspace)$/),
        content: z.string().max(2 * 1024 * 1024),
      })
      .strict()
      .parse(payload);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: label('保存文件', 'Save file'),
      defaultPath: join(app.getPath('downloads'), request.name),
      filters: [
        {
          name: request.name.endsWith('.md') ? 'Markdown' : 'VS Code Workspace',
          extensions: [request.name.endsWith('.md') ? 'md' : 'code-workspace'],
        },
      ],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, request.content, 'utf8');
    return true;
  });
  handle('tandem:copy-text', (_event, payload) => {
    clipboard.writeText(
      z
        .string()
        .max(2 * 1024 * 1024)
        .parse(payload),
    );
  });
  handle('tandem:info', async () => {
    let gitVersion: string | null = null;
    try {
      gitVersion = (
        await promisify(execFile)('git', ['--version'], { windowsHide: true, timeout: 5000 })
      ).stdout.trim();
    } catch {
      /* Show a readable missing-Git status in Settings. */
    }
    return {
      version: app.getVersion(),
      platform: process.platform,
      dataDirectory,
      gitVersion,
      packaged: app.isPackaged,
    };
  });
  handle('tandem:reveal-data', async () => {
    const error = await shell.openPath(dataDirectory);
    if (error) throw new AppError('OPEN_DIRECTORY_FAILED');
  });
  handle('tandem:open-worktree', async (_event, payload) => {
    const { taskId, bindingId } = z
      .object({ taskId: z.string().uuid(), bindingId: z.string().uuid() })
      .strict()
      .parse(payload);
    const binding = application!.service
      .task(taskId)
      .bindings.find((item) => item.id === bindingId);
    if (!binding) throw new AppError('BINDING_NOT_FOUND');
    let directory: string;
    try {
      directory = await realpath(binding.worktreePath);
      if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory');
    } catch {
      throw new AppError('PATH_NOT_FOUND');
    }
    const error = await shell.openPath(directory);
    if (error) throw new AppError('OPEN_DIRECTORY_FAILED');
  });
  handle('tandem:switch-data', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: label('选择同序数据目录', 'Select a Tandem data directory'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    const selected = result.filePaths[0];
    try {
      const entries = await readdir(selected);
      if (entries.length && !entries.includes('state.json')) throw new Error('NOT_A_WORKSPACE');
      if (entries.includes('state.json'))
        stateSchema.parse(JSON.parse(await readFile(join(selected, 'state.json'), 'utf8')));
      if (entries.includes('server.lock')) {
        const lock = JSON.parse(await readFile(join(selected, 'server.lock'), 'utf8'));
        let running = false;
        if (Number.isInteger(lock.pid) && lock.pid > 0) {
          try {
            process.kill(lock.pid, 0);
            running = true;
          } catch (error: any) {
            running = error.code === 'EPERM';
          }
        }
        if (running) throw new Error('WORKSPACE_BUSY');
      }
    } catch (error: any) {
      await dialog.showMessageBox(mainWindow!, {
        type: 'error',
        title: label('无法打开工作台', 'Cannot open workspace'),
        message:
          error.message === 'WORKSPACE_BUSY'
            ? label(
                '此工作台正在使用，请先关闭对应应用或本地服务。',
                'This workspace is in use. Close its application or local service first.',
              )
            : label(
                '请选择包含有效 state.json 的同序目录，或一个空目录。',
                'Select a Tandem directory with a valid state.json file, or an empty directory.',
              ),
        detail: selected,
        buttons: [label('确定', 'OK')],
      });
      return false;
    }
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: label('切换工作台', 'Switch workspace'),
      message: label('重启后使用所选数据目录？', 'Use this data directory after restarting?'),
      detail: selected,
      buttons: [label('取消', 'Cancel'), label('切换并重启', 'Switch and restart')],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) return false;
    pendingWorkspace = selected;
    mainWindow?.close();
    return true;
  });

  setMenu();
  const storedBounds = preferences.bounds;
  const visibleBounds =
    storedBounds &&
    screen.getAllDisplays().some((display) => {
      const x = storedBounds.x ?? display.workArea.x,
        y = storedBounds.y ?? display.workArea.y;
      return (
        x + 150 > display.workArea.x &&
        x < display.workArea.x + display.workArea.width - 100 &&
        y + 100 > display.workArea.y &&
        y < display.workArea.y + display.workArea.height - 100
      );
    });
  mainWindow = new BrowserWindow({
    width: preferences.bounds?.width || 1440,
    height: preferences.bounds?.height || 940,
    minWidth: 860,
    minHeight: 640,
    show: false,
    ...(visibleBounds && storedBounds?.x !== undefined
      ? { x: storedBounds.x, y: storedBounds.y }
      : {}),
    title: 'Tandem',
    backgroundColor: '#ffffff',
    icon: join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('tandem://app/')) {
      event.preventDefault();
      external(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable)
      menu.push(
        { role: 'undo', label: label('撤销', 'Undo') },
        { role: 'redo', label: label('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: label('剪切', 'Cut') },
        { role: 'copy', label: label('复制', 'Copy') },
        { role: 'paste', label: label('粘贴', 'Paste') },
        { role: 'selectAll', label: label('全选', 'Select all') },
      );
    else if (params.selectionText) menu.push({ role: 'copy', label: label('复制', 'Copy') });
    if (menu.length) Menu.buildFromTemplate(menu).popup({ window: mainWindow! });
  });
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      message: label('有未保存的修改，仍要离开？', 'Leave with unsaved changes?'),
      buttons: [label('继续编辑', 'Keep editing'), label('离开', 'Leave')],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) event.preventDefault();
    else pendingWorkspace = undefined;
  });
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getNormalBounds();
    void savePreferences({ bounds: { ...bounds, maximized: mainWindow.isMaximized() } }).catch(
      console.error,
    );
  });
  mainWindow.once('ready-to-show', () => {
    if (preferences.bounds?.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  await mainWindow.loadURL('tandem://app/index.html');
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    const next = pendingWorkspace;
    void (async () => {
      let restart = false;
      try {
        if (next) {
          await savePreferences({ dataDirectory: next, selectedTaskId: undefined });
          restart = true;
        }
      } finally {
        await Promise.all([application!.close(), preferenceStore.whenIdle()]);
      }
      if (restart || reopenRequested) app.relaunch();
    })()
      .catch((error) => {
        console.error(error);
      })
      .finally(() => app.quit());
  });
}

void main().catch(async (error) => {
  console.error(error);
  await application?.close().catch(() => undefined);
  await app.whenReady();
  const prefsError = error?.code === 'PREFERENCES_INVALID';
  const messages: Record<string, string> = {
    STATE_INVALID: label(
      '数据文件损坏，原文件已保留。',
      'The data file is invalid. The original has been preserved.',
    ),
    STATE_VERSION_NEWER: label(
      '此工作台由更新版本创建，请升级应用后再打开。文件已保留。',
      'This workspace requires a newer application version. Upgrade before opening it. Files have been preserved.',
    ),
    STATE_RECOVERY_REQUIRED: label(
      '主数据文件缺失，已找到备份；没有创建空工作台。',
      'The primary data file is missing, but a backup exists. No empty workspace was created.',
    ),
    PREFERENCES_INVALID: label(
      '应用设置无法读取，已保留原文件及工作台数据。',
      'Application preferences could not be read. The original file and workspace data are preserved.',
    ),
    WORKSPACE_BUSY: label(
      '此工作台正在使用，请关闭使用同一目录的其他版本或服务。',
      'This workspace is in use. Close the other application or service using it.',
    ),
    LOCK_INVALID: label(
      '锁文件不完整，请关闭使用此目录的所有旧版程序后检查 server.lock。',
      'The lock record is incomplete. Close older applications using this directory before checking server.lock.',
    ),
  };
  const detail = messages[error?.code] || String(error?.message || error);
  const directory = prefsError
    ? app.getPath('userData')
    : resolve(
        process.env.TANDEM_DATA_DIR ||
          preferences.dataDirectory ||
          join(app.getPath('userData'), 'data'),
      );
  let recovery: string | undefined;
  try {
    if (prefsError) {
      preferenceSchema.parse(
        JSON.parse(await readFile(join(directory, 'preferences.backup.json'), 'utf8')),
      );
      recovery = label(
        '可恢复上一份设置备份，损坏文件会另外保留。',
        'A previous preferences backup can be restored. The damaged file will be retained.',
      );
    } else if (['STATE_INVALID', 'STATE_RECOVERY_REQUIRED'].includes(error?.code)) {
      const backup = await stateBackupInfo(directory);
      recovery = label(
        `备份：${backup.tasks} 个任务、${backup.repositories} 个仓库，${new Date(backup.modifiedAt).toLocaleString('zh-CN')}。恢复可能不含最近一次修改，损坏文件会另外保留。`,
        `Backup: ${backup.tasks} tasks, ${backup.repositories} repositories, ${new Date(backup.modifiedAt).toLocaleString('en')}. The most recent change may not be included. The damaged file will be retained.`,
      );
    }
  } catch {
    /* Recovery is offered only for a validated backup. */
  }
  const result = await dialog.showMessageBox({
    type: 'error',
    title: label('同序无法启动', 'Tandem could not start'),
    message: detail,
    detail: `${directory}${recovery ? '\n\n' + recovery : ''}`,
    buttons: [
      label('关闭', 'Close'),
      label('打开数据目录', 'Open data folder'),
      ...(recovery ? [label('恢复备份并重启', 'Restore backup and restart')] : []),
    ],
    defaultId: 0,
    cancelId: 0,
  });
  if (result.response === 1) await shell.openPath(directory);
  if (result.response === 2 && recovery) {
    try {
      if (prefsError) await restorePreferenceBackup(directory);
      else {
        const lease = await acquireWorkspaceLock(directory);
        try {
          await restoreStateBackup(directory);
        } finally {
          await lease.release();
        }
      }
      app.relaunch();
    } catch (recoveryError) {
      dialog.showErrorBox(label('恢复未完成', 'Recovery did not complete'), String(recoveryError));
    }
  }
  app.quit();
});
