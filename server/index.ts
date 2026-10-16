import { resolve } from 'node:path';
import { startApplication } from './app.js';

const application = await startApplication({
  directory: resolve(process.env.TANDEM_DATA_DIR || '.tandem'),
  clientDirectory: resolve('dist/client'),
  port: Number(process.env.PORT || 4317),
  development: process.argv.includes('--dev'),
});
console.log(`\n  Tandem / ??  ${application.origin}\n  Data: ${application.directory}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await application.close();
    process.exit(0);
  });
