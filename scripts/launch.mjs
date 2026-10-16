import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const port = Number(process.env.PORT || 4317);
const url = `http://127.0.0.1:${port}`;

function runNpm(args) {
  return new Promise((resolvePromise, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...args], {
            cwd: root,
            stdio: 'inherit',
            windowsHide: true,
          })
        : spawn('npm', args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`npm ${args.join(' ')} exited with ${code}`)),
    );
  });
}

async function running() {
  try {
    const response = await fetch(`${url}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
    const data = await response.json();
    return (
      response.ok &&
      (data.product === 'tandem' || data.version === '0.1.0') &&
      typeof data.token === 'string'
    );
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const command =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => console.log(`Open ${url} in your browser.`));
  child.unref();
}

try {
  if (await running()) {
    console.log(`Tandem is already running: ${url}`);
    openBrowser();
  } else {
    if (Number(process.versions.node.split('.')[0]) < 22)
      throw new Error('Tandem needs Node.js 22 or newer.');
    if (!existsSync('node_modules/express')) {
      console.log('\nInstalling dependencies / 正在安装依赖…\n');
      await runNpm(['ci']);
    }
    if (!existsSync('dist/server/index.js') || !existsSync('dist/client/index.html')) {
      console.log('\nBuilding Tandem / 正在构建同序…\n');
      await runNpm(['run', 'build']);
    }
    const child = spawn(process.execPath, ['dist/server/index.js'], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.once('exit', (code) => {
      process.exitCode = code || 0;
    });
    process.once('SIGINT', () => child.kill('SIGINT'));
    process.once('SIGTERM', () => child.kill('SIGTERM'));
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await running()) {
        openBrowser();
        break;
      }
      if (child.exitCode !== null) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
} catch (error) {
  console.error('\nCould not start Tandem / 同序启动失败:', error.message);
  process.exitCode = 1;
}
