import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const versionSource = await readFile(join(root, 'shared/version.ts'), 'utf8');
if (!versionSource.includes(`APP_VERSION = '${pkg.version}'`)) {
  throw new Error('package.json and shared/version.ts must use the same version.');
}
const directory = join(root, 'release', pkg.version);
const name = `Tandem-Setup-${pkg.version}-x64.exe`;
const path = join(directory, name);
const hash = createHash('sha256');
for await (const chunk of createReadStream(path)) hash.update(chunk);
const sha256 = hash.digest('hex');
let commit = null;
try {
  commit = execFileSync(
    'git',
    ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  ).trim();
} catch {
  // A source archive can be built without Git metadata.
}
const manifest = {
  product: 'Tandem',
  version: pkg.version,
  platform: 'win32',
  arch: 'x64',
  commit,
  builtAt: new Date().toISOString(),
  files: [{ name, bytes: (await stat(path)).size, sha256 }],
};
await writeFile(join(directory, 'SHA256SUMS.txt'), `${sha256}  ${name}\n`);
await writeFile(join(directory, 'release-info.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${name}\nSHA-256: ${sha256}`);
