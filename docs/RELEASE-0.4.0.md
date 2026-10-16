# Tandem 0.4.0 / 同序 0.4.0

Review a task's changes across repositories in one workspace. This release adds a grouped file browser, side-by-side diffs and a focused reading layout, with English and Simplified Chinese throughout.

在一个工作区审阅任务涉及的多个仓库。此版本增加按仓库分组的文件列表、并排差异和专注阅读布局，完整提供中英文界面。

## Changes / 改进

- **All repositories together.** Filter by repository name or old/new file path; files with the same path in different repositories remain separate. Use the arrows or previous/next buttons to move between files. / **集中查看全部仓库。** 可按仓库名或新旧文件路径筛选；不同仓库中的同名文件独立显示。支持方向键及上一个/下一个文件。
- **Two diff layouts.** Switch between unified and side-by-side changes, enable line wrapping and keep these preferences after restarting. / **两种差异布局。** 支持统一、并排差异和长行换行，重启后保留阅读偏好。
- **Focus view.** Give the code more room while retaining the task title, branch, repository and file context. / **专注视图。** 扩大代码阅读区域，同时保留任务标题、分支、仓库与文件信息。
- **Steadier refresh.** Keep the current diff visible during refresh and cancel superseded browser requests. Large diffs start with 500 display rows and explicitly offer the remaining rows. / **更稳定的刷新。** 刷新期间保留当前差异，取消被替代的浏览器请求；大差异先显示 500 行，可继续展开，并明确显示已加载数量。
- **Working-directory actions.** Copy a worktree path or open its folder from the desktop application. Directory operations accept registered task/binding IDs and show localized OS failures. / **工作目录操作。** 支持复制 worktree 路径和在桌面版打开目录；仅接受已登记任务与仓库关联，系统操作失败时显示本地化提示。
- **Native error handling.** Preserve error codes across Electron's isolated bridge so actionable errors reach the interface. / **桌面错误处理。** 修复 Electron 隔离桥接丢失错误码的问题，让界面能显示具体原因。

## Install / 安装

Download `Tandem-Setup-0.4.0-x64.exe` from this release. Windows x64 and Git are required; Node.js and Python are not. Close older versions before installing. Data format 2 remains unchanged, and existing tasks and worktrees are retained.

下载发布附件 `Tandem-Setup-0.4.0-x64.exe`。需要 Windows x64 与 Git，无需 Node.js 或 Python。安装前退出旧版本；数据仍为格式 2，保留已有任务和工作目录。

`SHA256SUMS.txt` and `release-info.json` provide the installer checksum and source commit. Check it with `Get-FileHash .\Tandem-Setup-0.4.0-x64.exe -Algorithm SHA256`.

校验值与源码提交见上述两个附件；可以使用上述命令核对。

The installer is unsigned. Automatic updates and macOS/Linux installers are not included. This is an early Windows release for real-task evaluation. See the [validation record](https://github.com/xiao-zi-chen/Tandem/blob/v0.4.0/docs/VALIDATION.md) for test scope and limitations.

安装包尚未签名，没有自动更新或 macOS/Linux 安装包。当前为用于真实任务验证的 Windows 试用版；测试范围与边界见[验证记录](https://github.com/xiao-zi-chen/Tandem/blob/v0.4.0/docs/VALIDATION.md)。
