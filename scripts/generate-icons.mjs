import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('build', { recursive: true });
const svg = await readFile('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const entries = [];
try {
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const data = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg, size },
    );
    const buffer = Buffer.from(data, 'base64');
    entries.push({ size, buffer });
    if (size === 256) await writeFile('build/icon.png', buffer);
  }
} finally {
  await browser.close();
}
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
for (let index = 0; index < entries.length; index++) {
  const { size, buffer } = entries[index],
    position = 6 + index * 16;
  header[position] = size === 256 ? 0 : size;
  header[position + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(buffer.length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += buffer.length;
}
await writeFile('build/icon.ico', Buffer.concat([header, ...entries.map((entry) => entry.buffer)]));
