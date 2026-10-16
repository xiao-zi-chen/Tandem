import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, optionalGit } from './git.js';
import { AppError } from './errors.js';
import { WorkspaceService } from './service.js';
import type { Repository } from '../shared/types';

async function writeInitial(path: string, content: string) {
  try {
    const previous = await readFile(path, 'utf8');
    if (previous !== content) throw new AppError('SAMPLE_CONTENT_CONFLICT');
    return;
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
}

export async function createDemo(service: WorkspaceService) {
  if (service.state().demoLoaded) return service.state();
  const root = join(service.store.directory, 'sample-project');
  const repos: Repository[] = [];
  for (const name of ['web', 'api']) {
    const path = join(root, name);
    await mkdir(join(path, 'src'), { recursive: true });
    let initialized = false;
    try {
      await access(join(path, '.git'));
      initialized = true;
    } catch {
      /* First demo run. */
    }
    if (!initialized || !(await optionalGit(path, ['rev-parse', '--verify', 'HEAD']))) {
      if (!initialized) await git(path, ['init', '-b', 'main']);
      await git(path, ['config', '--local', 'core.hooksPath', join(root, 'empty-hooks')]);
      await git(path, ['config', '--local', 'commit.gpgsign', 'false']);
      await writeInitial(
        join(path, 'README.md'),
        `# Fieldnotes ${name}\n\nA small, local sample repository for Tandem.\n`,
      );
      await writeInitial(join(path, '.gitignore'), 'node_modules/\n.env\ndist/\n');
      if (name === 'web') {
        await writeInitial(
          join(path, 'src', 'pricing.ts'),
          "export type Plan = 'starter' | 'studio';\n\nexport const plans = {\n  starter: { name: 'Starter', monthlyPrice: 9 },\n  studio: { name: 'Studio', monthlyPrice: 24 },\n};\n\nexport function formatPrice(plan: Plan) {\n  return `$${plans[plan].monthlyPrice} / month`;\n}\n",
        );
        await writeInitial(
          join(path, 'src', 'navigation.ts'),
          "export function afterLogin() {\n  return '/dashboard';\n}\n",
        );
        await writeInitial(
          join(path, 'src', 'search.ts'),
          'export async function search(query: string) {\n  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);\n  return response.json();\n}\n',
        );
      } else {
        await writeInitial(
          join(path, 'src', 'billing.ts'),
          "export interface Subscription {\n  customerId: string;\n  plan: 'starter' | 'studio';\n}\n\nconst monthlyPrices = { starter: 9, studio: 24 };\n\nexport function calculateTotal(subscription: Subscription): number {\n  return monthlyPrices[subscription.plan];\n}\n",
        );
        await writeInitial(
          join(path, 'src', 'search.ts'),
          'export function searchNotes(query: string, notes: string[]) {\n  return notes.filter(note => note.includes(query));\n}\n',
        );
      }
      const files = [
        'README.md',
        '.gitignore',
        ...(name === 'web'
          ? ['src/pricing.ts', 'src/navigation.ts', 'src/search.ts']
          : ['src/billing.ts', 'src/search.ts']),
      ];
      const staged = (await git(path, ['diff', '--cached', '--name-only', '-z']))
        .split('\0')
        .filter(Boolean);
      if (staged.some((file) => !files.includes(file)))
        throw new AppError('SAMPLE_CONTENT_CONFLICT');
      await git(path, ['add', '--', ...files]);
      await git(path, [
        '-c',
        'user.name=Tandem Sample',
        '-c',
        'user.email=sample@tandem.local',
        'commit',
        '-m',
        'Initial sample project',
      ]);
    }
    repos.push(
      await service.addRepository(path, name === 'web' ? 'fieldnotes-web' : 'fieldnotes-api', true),
    );
  }

  const definitions = [
    {
      title: '订阅方案支持年付',
      titleEn: 'Add annual billing',
      branch: 'feature/annual-plans',
      both: true,
      description:
        '为 Starter 和 Studio 增加年付选项。后端计算折扣金额，前端展示月付 / 年付切换；交接前一起确认价格与文案。',
      descriptionEn:
        'Add annual billing to Starter and Studio. Keep the pricing calculation and plan selector in step, then review the numbers and copy together.',
    },
    {
      title: '修复登录后的返回路径',
      titleEn: 'Fix sign-in redirect',
      branch: 'fix/sign-in-redirect',
      both: false,
      description: '登录完成后返回用户原本访问的页面，并检查返回地址是否为站内路径。',
      descriptionEn:
        'Return people to the page they were visiting after sign-in. Only allow safe, same-site return paths.',
    },
    {
      title: '为搜索结果增加分页',
      titleEn: 'Paginate search results',
      branch: 'feature/search-pagination',
      both: true,
      description: '统一前后端的分页参数，保留搜索关键词，检查空结果与最后一页。',
      descriptionEn:
        'Align pagination parameters across the web app and API. Keep the query intact and check empty results and the last page.',
    },
  ];

  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    const existing = service
      .state()
      .tasks.find((t) =>
        t.bindings.some(
          (b) => b.branch === definition.branch && repos.some((repo) => repo.id === b.repositoryId),
        ),
      );
    if (existing) continue;
    const task = await service.createTask(
      {
        title: definition.title,
        description: definition.description,
        operationId: randomUUID(),
        repositories: (definition.both ? repos : [repos[0]]).map((repo) => ({
          repositoryId: repo.id,
          mode: 'create',
          branch: definition.branch,
          baseRef: 'main',
        })),
      },
      { demo: true, titleEn: definition.titleEn, descriptionEn: definition.descriptionEn },
    );
    for (const binding of task.bindings) {
      const web = binding.repositoryId === repos[0].id;
      if (index === 0 && web) {
        await writeFile(
          join(binding.worktreePath, 'src', 'pricing.ts'),
          "export type Plan = 'starter' | 'studio';\nexport type BillingCycle = 'monthly' | 'annual';\n\nexport const plans = {\n  starter: { name: 'Starter', monthlyPrice: 9, annualPrice: 90 },\n  studio: { name: 'Studio', monthlyPrice: 24, annualPrice: 240 },\n};\n\nexport function formatPrice(plan: Plan, cycle: BillingCycle = 'monthly') {\n  const price = cycle === 'annual'\n    ? plans[plan].annualPrice\n    : plans[plan].monthlyPrice;\n\n  return `$${price} / ${cycle === 'annual' ? 'year' : 'month'}`;\n}\n",
        );
        await writeFile(
          join(binding.worktreePath, 'src', 'billing-toggle.ts'),
          "import type { BillingCycle } from './pricing';\n\nexport const billingOptions: { value: BillingCycle; label: string }[] = [\n  { value: 'monthly', label: 'Monthly' },\n  { value: 'annual', label: 'Annually — 2 months on us' },\n];\n",
        );
      } else if (index === 0) {
        await writeFile(
          join(binding.worktreePath, 'src', 'billing.ts'),
          "export interface Subscription {\n  customerId: string;\n  plan: 'starter' | 'studio';\n  billingCycle: 'monthly' | 'annual';\n}\n\nconst monthlyPrices = { starter: 9, studio: 24 };\nconst ANNUAL_BILLABLE_MONTHS = 10;\n\nexport function calculateTotal(subscription: Subscription): number {\n  const monthly = monthlyPrices[subscription.plan];\n  return subscription.billingCycle === 'annual'\n    ? monthly * ANNUAL_BILLABLE_MONTHS\n    : monthly;\n}\n",
        );
        await git(binding.worktreePath, ['add', 'src/billing.ts']);
      } else if (index === 1) {
        await writeFile(
          join(binding.worktreePath, 'src', 'navigation.ts'),
          "export function afterLogin(returnTo?: string) {\n  if (returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\\\')) {\n    return returnTo;\n  }\n  return '/dashboard';\n}\n",
        );
        await git(binding.worktreePath, ['add', '.']);
        await git(binding.worktreePath, [
          '-c',
          'user.name=Tandem Sample',
          '-c',
          'user.email=sample@tandem.local',
          'commit',
          '-m',
          'Preserve safe return paths after sign-in',
        ]);
      } else if (index === 2 && web) {
        await writeFile(
          join(binding.worktreePath, 'src', 'search.ts'),
          "export async function search(query: string, page = 1) {\n  const params = new URLSearchParams({ q: query, page: String(page) });\n  const response = await fetch(`/api/search?${params}`);\n  if (!response.ok) throw new Error('Search is temporarily unavailable');\n  return response.json();\n}\n",
        );
      } else {
        await writeFile(
          join(binding.worktreePath, 'src', 'search.ts'),
          'const PAGE_SIZE = 20;\n\nexport function searchNotes(query: string, notes: string[], page = 1) {\n  const matches = notes.filter(note => note.includes(query));\n  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;\n  return {\n    results: matches.slice(offset, offset + PAGE_SIZE),\n    total: matches.length,\n    page,\n  };\n}\n',
        );
      }
    }
    await service.store.transaction((state) => {
      const saved = state.tasks.find((t) => t.id === task.id)!;
      if (saved.revision > 0) return;
      saved.demo = true;
      saved.titleEn = definition.titleEn;
      saved.descriptionEn = definition.descriptionEn;
      saved.status = index === 1 ? 'review' : 'active';
      saved.checklist =
        index === 0
          ? [
              {
                id: randomUUID(),
                text: '确认前后端价格计算一致',
                textEn: 'Match pricing across the web app and API',
                done: true,
              },
              {
                id: randomUUID(),
                text: '检查年付切换与价格文案',
                textEn: 'Check the annual toggle and pricing copy',
                done: false,
              },
              {
                id: randomUUID(),
                text: '关联两边 PR，准备交接',
                textEn: 'Link both PRs and prepare the handoff',
                done: false,
              },
            ]
          : index === 1
            ? [
                {
                  id: randomUUID(),
                  text: '验证站内返回路径',
                  textEn: 'Verify same-site return paths',
                  done: true,
                },
                {
                  id: randomUUID(),
                  text: '拒绝外部重定向地址',
                  textEn: 'Reject external redirect URLs',
                  done: true,
                },
              ]
            : [
                {
                  id: randomUUID(),
                  text: '联调空结果与最后一页',
                  textEn: 'Test empty results and the last page together',
                  done: false,
                },
              ];
    });
  }
  if (!service.state().repoSets.some((s) => s.name === 'Fieldnotes'))
    await service.saveRepoSet(
      'Fieldnotes',
      repos.map((r) => r.id),
    );
  await service.store.transaction((state) => {
    state.demoLoaded = true;
  });
  return service.state();
}
