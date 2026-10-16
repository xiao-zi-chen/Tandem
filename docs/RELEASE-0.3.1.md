# Tandem 0.3.1 / 同序 0.3.1

An early Windows x64 desktop release for tasks that span independent Git repositories. English and Simplified Chinese are included.

面向跨独立 Git 仓库任务的 Windows x64 桌面试用版，包含完整中英文界面。

## Improvements / 本轮改进

- Unified diffs preserve source lines beginning with `-- ` or `++ ` and their correct line numbers. / 修复差异视图误隐藏以 `-- ` 或 `++ ` 开头的源码行及后续行号错误。
- Find renamed files by either their current or previous path. / 支持通过新旧路径筛选重命名文件。
- Search tasks by title, repository, branch, PR number or URL, including combined terms. / 可组合搜索任务名、仓库、分支、PR 编号或地址。
- Navigate task search using arrows and Enter, with Chinese IME composition respected. / 任务搜索支持方向键和回车，并兼容中文输入法选词。
- Settings links to downloads, release notes and issue reporting. / 设置中提供下载、更新记录与反馈入口。
- Windows checks, a release-build workflow, bilingual issue templates and checksum generation. / 增加 Windows 自动检查、发布构建流程、中英文反馈模板与校验文件生成。

## Install / 安装

Download `Tandem-Setup-0.3.1-x64.exe` from the release assets. Git must be installed and available on PATH; Node.js and Python are not required. Close older Tandem versions before installing. Existing format-2 workspaces remain compatible with 0.3.1. The installer is currently unsigned.

从发布附件下载 `Tandem-Setup-0.3.1-x64.exe`。本机需要 Git，不需要 Node.js 或 Python。安装前退出旧版本；0.3.1 继续兼容已有格式 2 工作台。安装包目前未签名。

`SHA256SUMS.txt` contains the installer checksum; `release-info.json` records its version, size and source commit. On Windows, use `Get-FileHash .\Tandem-Setup-0.3.1-x64.exe -Algorithm SHA256` to compare it.

`SHA256SUMS.txt` 提供安装包校验值，`release-info.json` 记录版本、大小与源码提交。Windows 可使用上述命令核对。

## Current limits / 当前边界

Windows x64 is the verified desktop target. Automatic updates, signed builds and macOS/Linux installers are not included. PR links support GitHub; Tandem does not automatically push or merge. Worktrees do not isolate project dependencies, ports or databases. See [validation](https://github.com/xiao-zi-chen/Tandem/blob/v0.3.1/docs/VALIDATION.md) for test scope.

目前验证的平台为 Windows x64；尚无自动更新、签名构建或 macOS/Linux 安装包。PR 关联支持 GitHub，不自动推送或合并。Worktree 不隔离项目依赖、端口与数据库。测试范围见[验证记录](https://github.com/xiao-zi-chen/Tandem/blob/v0.3.1/docs/VALIDATION.md)。
