import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync(
  'git',
  [
    '-c',
    `safe.directory=${root.replaceAll('\\', '/')}`,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ],
  { cwd: root, encoding: 'utf8', windowsHide: true },
)
  .split('\0')
  .filter(Boolean);
const known = new Set(files);
const documents = files.filter((file) => file.endsWith('.md'));
const failures = [];
let checked = 0;

for (const file of documents) {
  const text = (await readFile(resolve(root, file), 'utf8')).replace(
    /^```[^\n]*\n[\s\S]*?^```\s*$/gm,
    '',
  );
  const targets = [
    ...text.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\)/g),
    ...text.matchAll(/(?:src|href)=["']([^"']+)["']/g),
    ...text.matchAll(/^\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm),
  ];
  for (const [, raw] of targets) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw)) continue;
    const path = raw.split(/[?#]/, 1)[0];
    if (!path) continue;
    let target;
    try {
      target = posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(path)));
    } catch {
      failures.push(`${file}: invalid URL encoding in ${raw}`);
      continue;
    }
    checked++;
    if (
      !known.has(target) &&
      !files.some((entry) => entry.startsWith(`${target.replace(/\/$/, '')}/`))
    ) {
      failures.push(`${file}: missing or incorrectly cased target ${raw}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${checked} relative file/image links in ${documents.length} Markdown files.`,
  );
}
