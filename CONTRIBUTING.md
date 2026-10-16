# Development guide / 开发指南

[English home](README.md) · [中文首页](README.zh-CN.md) · [Documentation / 文档](docs/README.md)

Tandem organizes tasks across independent repositories. Changes should make everyday Git work easier to understand and preserve existing branches, files, and drafts. English and Chinese are both welcome in issues and pull requests.

同序围绕跨仓库任务组织工作。改进应让日常 Git 操作更清楚，并保护已有分支、文件和草稿。Issue 和 PR 均可使用中文或英文。

## Choose a focused change / 从具体问题开始

- [Report a reproducible bug](https://github.com/xiao-zi-chen/Tandem/issues/new?template=bug_report.yml), including versions and steps. / [反馈可复现的问题](https://github.com/xiao-zi-chen/Tandem/issues/new?template=bug_report.yml)，附上版本与步骤。
- [Describe a workflow](https://github.com/xiao-zi-chen/Tandem/issues/new?template=feature_request.yml) for a larger feature before building it. Include the repositories, repeated steps, and desired outcome. / 较大功能建议先[描述真实工作流程](https://github.com/xiao-zi-chen/Tandem/issues/new?template=feature_request.yml)，说明涉及仓库、重复步骤与希望达到的效果。
- Improve the quick start, translation, or error wording with a focused pull request. / 上手说明、翻译或错误文案可以通过聚焦的 PR 改进。

## Local development / 本地开发

Use **Windows x64, Node.js 24 LTS, and Git** for the verified development path. Clone your fork or this repository, then run from its root:

已验证的开发环境为 **Windows x64、Node.js 24 LTS 与 Git**。克隆自己的 fork 或本仓库后，在根目录执行：

```sh
npm ci
node node_modules/electron/install.js
npm run desktop:dev
```

The Electron install step downloads the runtime if it is missing. On Node.js 24, a development machine using an HTTP(S) proxy may need `NODE_USE_ENV_PROXY=1` for that download. Installer users already have the runtime bundled.

Electron 安装步骤在缺少运行时时下载它。Node.js 24 开发环境使用 HTTP(S) 代理时，下载可能需要设置 `NODE_USE_ENV_PROXY=1`；成品安装包已包含运行时。

`npm run dev` starts the browser development preview. It does not exercise native menus, dialogs, or desktop IPC. Use the desktop build to verify those features.

`npm run dev` 启动浏览器开发预览，不能覆盖原生菜单、对话框与桌面 IPC；这些功能需要在桌面构建中验证。

## Project map / 目录结构

| Path       | Responsibility / 职责                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `src/`     | React UI, review workspace, note drafts, and localization / 界面、变更审阅、备注草稿与本地化        |
| `desktop/` | Electron main process, preload bridge, native integration / 主进程、隔离桥接与原生集成              |
| `server/`  | Git operations, task service, metadata, and recovery / Git 操作、任务服务、元数据与恢复             |
| `shared/`  | Shared types, desktop contract, and application version / 共享类型、桌面接口与版本                  |
| `tests/`   | Git, reliability, frontend, browser, and desktop verification / Git、可靠性、前端、浏览器与桌面验证 |
| `docs/`    | User guides, architecture, release notes, and validation / 用户指南、架构、版本与验证记录           |

Read [Architecture](docs/ARCHITECTURE.md) before changing Git operations, persistence, or desktop boundaries.

调整 Git 操作、持久化或桌面边界前，请阅读[技术架构](docs/ARCHITECTURE.md)。

## Checks / 检查

Run checks appropriate to the change. The Windows CI workflow runs the full application verification on pushes and pull requests.

按修改范围执行检查；Windows CI 会在推送和 PR 时执行完整应用验证。

| Command                           | Purpose / 用途                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `npm run format:check`            | Formatting across source and documentation / 源码与文档格式                      |
| `npm run docs:check`              | Relative documentation links and images / 文档相对链接与图片                     |
| `npm test`                        | Git behavior, reliability, and frontend logic / Git 行为、可靠性与前端逻辑       |
| `npm run build`                   | Type checking and production bundles / 类型检查与生产构建                        |
| `npx playwright install chromium` | Browser test prerequisite / 浏览器测试准备                                       |
| `npm run test:e2e`                | Browser workflows / 浏览器流程                                                   |
| `npm run desktop:pack`            | Build and package the desktop executable / 构建并打包桌面程序                    |
| `npm run test:desktop`            | Native verification against the packaged executable / 对实际打包程序执行原生验证 |

Tests create independent repositories in temporary directories. Desktop tests use separate application data. Never use your working repositories as destructive test fixtures. For scope and limitations, see [Validation](docs/VALIDATION.md).

测试使用临时目录中的独立仓库，桌面测试使用独立应用数据。不要拿实际工作仓库做破坏性测试。覆盖范围与边界见[验证记录](docs/VALIDATION.md)。

## Before opening a PR / 提交 PR 前

- Explain the problem, resulting behavior, and checks actually performed. / 说明问题、修改后的行为与实际执行的验证。
- Add UI text in both languages in `src/i18n.ts`; user-authored task text is not automatically translated. Include screenshots for visual changes. / 界面文案需在 `src/i18n.ts` 同时提供中英文；用户输入不自动翻译。界面调整请附截图。
- Include regression coverage for Git behavior or data integrity changes. / Git 行为或数据可靠性的修改需要回归验证。
- Update both language versions of user-facing documentation. / 用户文档的中英文版本同步更新。
- Keep local application data, credentials, installers, and captured research pages out of Git. / 不提交本地数据、凭据、安装包或采集的网页。

## Publishing / 发布

Update `package.json`, the root version fields in `package-lock.json`, `shared/version.ts`, and the desktop launcher together. Update the download links and preview version in both READMEs and user guides. Build with `npm run desktop:dist`, verify with `npm run test:desktop`, then run `npm run release:manifest` for checksums. Upload binaries as GitHub Release assets, never as source commits.

同步更新上述版本字段、桌面启动脚本，以及中英文 README 和用户指南中的下载链接与预览版号。构建、验证后生成校验文件；安装包放在 GitHub Release 附件中，不提交到源码历史。

The **Build Windows release** workflow builds an existing version tag and creates a draft release only after checks pass. It does not replace an existing release. Review the bilingual release notes before publishing the draft. Signing and automatic updates are not configured.

**Build Windows release** 工作流从已有版本标签构建，通过检查后创建草稿发布，不覆盖已有发布。补全中英文说明后再发布；目前尚未配置代码签名与自动更新。

## License / 许可

The project is currently **UNLICENSED**; the owner has not selected an open-source license. Third-party dependencies retain their own licenses.

项目当前为 **UNLICENSED**，所有者尚未选定开源许可证；第三方依赖保留各自的许可。
