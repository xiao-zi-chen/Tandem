# Contributing / 参与开发

Tandem organizes tasks across independent repositories. Changes should make everyday Git work easier to understand and preserve existing branches, files and drafts.

同序围绕跨仓库任务组织工作。改进应让日常 Git 操作更清楚，并保护已有分支、文件和草稿。

## Local development / 本地开发

Use Windows x64, Node.js 24 LTS and Git. Run `npm ci`, then `node node_modules/electron/install.js` if the Electron runtime was not downloaded, and `npm run desktop:dev`.

使用 Windows x64、Node.js 24 LTS 与 Git。执行 `npm ci`；若 Electron 运行时未下载，再执行 `node node_modules/electron/install.js`，最后运行 `npm run desktop:dev`。

```sh
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run desktop:pack
npm run test:desktop
```

Tests create independent repositories in temporary directories. Desktop tests use a separate application-data directory. Never use your working repositories as destructive test fixtures.

测试使用临时目录中的独立仓库；桌面测试使用独立应用数据目录。不要拿实际工作仓库做破坏性测试。

## Changes / 修改约定

- Add both languages to `src/i18n.ts`; user-authored task text is not automatically translated. / 界面文案同时提供中英文；用户输入不自动翻译。
- Include a regression test for changes to Git behavior or data integrity. / Git 操作和数据可靠性的修改需要回归验证。
- Keep local application data, credentials, installers and captured research pages out of Git. / 不提交本地数据、凭据、安装包或采集的网页。
- Use [issues](https://github.com/xiao-zi-chen/Tandem/issues/new/choose) to describe reproducible problems or a real workflow. / 反馈时描述复现步骤或真实工作流程。

## Publishing / 发布

Update `package.json`, the root version in `package-lock.json`, `shared/version.ts` and the desktop launcher together. Build the installer with `npm run desktop:dist`, verify it with `npm run test:desktop`, then run `npm run release:manifest` to generate checksums. Upload binaries as GitHub Release assets, never as source commits.

版本号需同步更新到上述文件。构建、验证后生成校验文件，将安装包放在 GitHub Release 附件中，不能提交到源码历史。

The **Build Windows release** workflow builds an existing version tag and creates a draft release only after checks pass. It does not replace an existing release. Review the bilingual release notes before publishing the draft. Signing and automatic updates are not configured.

**Build Windows release** 工作流从已有版本标签构建，通过检查后创建草稿发布，不覆盖已有发布。补全中英文说明后再发布；目前尚未配置代码签名与自动更新。

## License / 许可

The project is currently `UNLICENSED`; publication of its source does not grant an open-source license. A license has not yet been selected by the owner. Third-party dependencies retain their own licenses.

项目当前为 `UNLICENSED`，公开源码不等同于授予开源许可；项目所有者尚未选定许可证。第三方依赖保留各自的许可。
