import express from 'express';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { Store } from './store.js';
import { WorkspaceService } from './service.js';
import { describeError } from './errors.js';
import { createDemo } from './demo.js';
import { acquireWorkspaceLock } from './workspace-lock.js';
import { APP_VERSION } from '../shared/version.js';

export interface ApplicationOptions {
  directory: string;
  clientDirectory: string;
  port?: number;
  development?: boolean;
  fetcher?: typeof fetch;
}

export async function startApplication(options: ApplicationOptions) {
  const port = options.port ?? 4317;
  const directory = resolve(options.directory);
  const development = options.development ?? false;
  const clientDirectory = resolve(options.clientDirectory);
  const lease = await acquireWorkspaceLock(directory);
  try {
    const service = new WorkspaceService(new Store(directory), options.fetcher);
    try {
      await service.init();
    } catch (error) {
      await lease.release();
      throw error;
    }
    const token = randomBytes(32).toString('hex');
    const app = express();
    let stopping = false;
    const pending = new Set<Promise<unknown>>();
    function route(
      method: 'get' | 'post' | 'patch' | 'delete',
      path: string,
      handler: (req: express.Request, res: express.Response) => unknown,
    ) {
      app[method](path, (req, res, next) => {
        const work = Promise.resolve().then(() => handler(req, res));
        pending.add(work);
        void work.catch(next).finally(() => pending.delete(work));
      });
    }
    app.disable('x-powered-by');
    app.use((req, res, next) => {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname))
        return res.status(403).json({ code: 'FORBIDDEN' });
      const origin = req.get('origin');
      if (origin && origin !== `http://${req.get('host')}`)
        return res.status(403).json({ code: 'FORBIDDEN' });
      if (req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).json({ code: 'FORBIDDEN' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      if (!development)
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
        );
      next();
    });
    app.use(express.json({ limit: '128kb' }));
    route('get', '/api/bootstrap', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ token, product: 'tandem', version: APP_VERSION });
    });
    app.use('/api', (req, res, next) => {
      if (stopping) return res.status(503).json({ code: 'SHUTTING_DOWN' });
      res.setHeader('Cache-Control', 'no-store');
      if (req.get('x-tandem-token') !== token) return res.status(403).json({ code: 'FORBIDDEN' });
      next();
    });

    const text = z.string().trim().min(1).max(120);
    const id = z.string().uuid();
    const createInput = z.object({
      title: text,
      description: z.string().max(6000).optional(),
      operationId: id,
      repositories: z
        .array(
          z.object({
            repositoryId: id,
            mode: z.enum(['create', 'existing', 'attach']),
            branch: z.string().min(1).max(180),
            baseRef: z.string().min(1).max(240),
            worktreePath: z.string().max(4096).optional(),
          }),
        )
        .min(1)
        .max(20),
    });

    route('get', '/api/state', (_req, res) => res.json(service.state()));
    route('post', '/api/repositories', async (req, res) => {
      const value = z
        .object({ path: z.string().trim().min(1).max(4096), name: text.optional() })
        .parse(req.body);
      res.json(await service.addRepository(value.path, value.name));
    });
    route('get', '/api/repositories/:id', async (req, res) =>
      res.json(await service.repositoryInfo(id.parse(req.params.id))),
    );
    route('delete', '/api/repositories/:id', async (req, res) => {
      await service.removeRepository(id.parse(req.params.id));
      res.json({ ok: true });
    });
    route('post', '/api/sets', async (req, res) => {
      const value = z
        .object({ name: text, repositoryIds: z.array(id).min(1).max(20) })
        .parse(req.body);
      res.json(await service.saveRepoSet(value.name, value.repositoryIds));
    });
    route('delete', '/api/sets/:id', async (req, res) => {
      const setId = id.parse(req.params.id);
      await service.store.transaction((state) => {
        state.repoSets = state.repoSets.filter((s) => s.id !== setId);
      });
      res.json({ ok: true });
    });
    route('post', '/api/tasks', async (req, res) =>
      res.json(await service.createTask(createInput.parse(req.body))),
    );
    route('get', '/api/tasks/:id', async (req, res) =>
      res.json(await service.taskDetail(id.parse(req.params.id))),
    );
    route('patch', '/api/tasks/:id', async (req, res) => {
      const patch = z
        .object({
          title: text.optional(),
          expectedRevision: z.number().int().nonnegative(),
          description: z.string().max(6000).optional(),
          status: z.enum(['active', 'review', 'done']).optional(),
          archivedAt: z.union([z.string().datetime(), z.null()]).optional(),
          checklist: z
            .array(
              z.object({
                id,
                text: z.string().trim().min(1).max(300),
                textEn: z.string().max(300).optional(),
                done: z.boolean(),
              }),
            )
            .max(50)
            .optional(),
        })
        .strict()
        .parse(req.body);
      const { expectedRevision, ...changes } = patch;
      res.json(await service.updateTask(id.parse(req.params.id), changes, expectedRevision));
    });
    route('get', '/api/tasks/:id/diff/:bindingId', async (req, res) => {
      const { file, mode } = z
        .object({
          file: z.string().min(1).max(4096),
          mode: z.enum(['working', 'staged', 'branch']),
        })
        .parse(req.query);
      res.json(
        await service.diff(id.parse(req.params.id), id.parse(req.params.bindingId), file, mode),
      );
    });
    route('post', '/api/tasks/:id/pr/:bindingId', async (req, res) => {
      const { url } = z.object({ url: z.url().max(2000) }).parse(req.body);
      res.json(await service.linkPr(id.parse(req.params.id), id.parse(req.params.bindingId), url));
    });
    route('delete', '/api/tasks/:id/pr/:bindingId/:prId', async (req, res) =>
      res.json(
        await service.unlinkPr(
          id.parse(req.params.id),
          id.parse(req.params.bindingId),
          id.parse(req.params.prId),
        ),
      ),
    );
    route('post', '/api/tasks/:id/refresh-prs', async (req, res) =>
      res.json(await service.refreshPrs(id.parse(req.params.id))),
    );
    route('post', '/api/tasks/:id/open', async (req, res) => {
      await service.openWorkspace(id.parse(req.params.id));
      res.json({ ok: true });
    });
    route('get', '/api/tasks/:id/workspace', async (req, res) => {
      const path = await service.workspaceFile(id.parse(req.params.id));
      res.type('application/json').send(await readFile(path, 'utf8'));
    });
    route('get', '/api/tasks/:id/handoff', async (req, res) =>
      res.json({
        markdown: await service.handoff(
          id.parse(req.params.id),
          z.enum(['zh-CN', 'en']).parse(req.query.locale || 'zh-CN'),
        ),
      }),
    );
    route('post', '/api/operations/:id/recover', async (req, res) =>
      res.json(await service.recoverOperation(id.parse(req.params.id))),
    );
    let demoRun: Promise<unknown> | undefined;
    route('post', '/api/demo', async (_req, res) => {
      if (!demoRun)
        demoRun = createDemo(service).finally(() => {
          demoRun = undefined;
        });
      res.json(await demoRun);
    });
    app.use('/api', (_req, res) => res.status(404).json({ code: 'NOT_FOUND' }));
    app.use(
      (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        if (error instanceof z.ZodError)
          return res.status(400).json({
            code: 'VALIDATION',
            details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          });
        const mapped = describeError(error);
        if (mapped.status === 500) console.error(error);
        res.status(mapped.status).json({ code: mapped.code, details: mapped.details });
      },
    );

    const server = createServer(app);
    if (development) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, ws: { server } },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(clientDirectory));
      app.get('/{*path}', (_req, res) => res.sendFile(join(clientDirectory, 'index.html')));
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    }).catch(async (error) => {
      await lease.release();
      throw error;
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Could not bind the local service');
    const origin = `http://127.0.0.1:${address.port}`;
    let closed = false;
    return {
      service,
      origin,
      directory,
      async close() {
        if (closed) return;
        closed = true;
        stopping = true;
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        });
        while (pending.size) await Promise.allSettled([...pending]);
        await service.whenIdle();
        await lease.release();
      },
    };
  } catch (error) {
    await lease.release();
    throw error;
  }
}
