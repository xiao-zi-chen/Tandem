# 0.3.2 Validation / 验证记录

日期：2026-10-16。环境：Windows x64、Git 2.47.0.windows.2、Node.js 24.19.0、Electron 44.8.0。

| 项目                          | 结果           |
| ----------------------------- | -------------- |
| TypeScript 严格检查与生产构建 | 通过           |
| Git / 业务核心测试            | 19 项通过      |
| 恢复 / 文件写入 / 启停测试    | 10 项通过      |
| 差异解析 / 任务检索回归测试   | 4 项通过       |
| 浏览器完整流程                | 12 项通过      |
| 实际打包后的桌面程序          | 8 组验证通过   |
| Windows NSIS 安装包构建       | 成功           |
| 生产 npm 依赖审计             | 0 个已报告漏洞 |
| 代码签名状态                  | NotSigned      |

0.3.2 新增回归覆盖差异内容被误当文件头隐藏、源码行号、无末尾换行、重命名旧路径搜索，以及跨任务名、仓库、分支和 PR 的组合搜索。浏览器验证在真实临时 Git 仓库中提交并重命名文件，确认以 `-- ` 和 `++ ` 开头的源码行仍完整可见。

All 33 code/reliability tests, 12 browser workflows and 8 packaged-desktop verification groups passed locally on Windows x64. TypeScript, production build, formatting and the production dependency audit passed. Browser tests exercise a real Git rename and verify source lines that resemble diff headers. The audit reported no known production dependency vulnerabilities at the time of this check.

GitHub 的全新 Windows 环境曾发现短路径与完整路径身份不一致，导致恢复操作保守跳过空 worktree。0.3.2 通过实际文件系统解析目录身份，也覆盖目录联接和未创建的子目录；新增测试验证回滚只清理无改动工作区并保留忽略文件。

此前 0.3 的数据可靠性修复继续通过回归，详细处理见[可靠性记录](RELIABILITY-0.3.md)。

## 桌面程序

验证执行 `release/0.3.2/win-unpacked/Tandem.exe`，确认 `app.isPackaged === true`，覆盖：

1. 独立程序启动、稳定应用来源、独立用户数据目录，以及实际开启的沙箱和上下文隔离。
2. 两仓库示例 worktree 与真实 Git 状态读取。
3. 工作区、新文件与暂存差异，以及文件筛选。
4. 原生剪贴板与保存对话框 IPC，实际 Markdown 文件写入。
5. 应用菜单、目录选择 IPC 和现有仓库连接。
6. 取消关闭/切换工作台后，备注、服务与原数据目录仍然有效。
7. 关闭并重开后，语言、窗口尺寸、任务和仓库数据保留。
8. 原生搜索快捷键、跨仓库关键词检索、方向键选择与回车打开；设置中的下载与反馈链接。

目录/保存选择器的返回值由自动化模拟，验证调用链与文件操作；未自动操作系统对话框控件。安装向导本身未在本机实际执行。未测试 macOS/Linux 安装包、VS Code 外部窗口或用户的私有 GitHub 账号。

Native tests run the actual packaged executable. OS folder/save-dialog results are simulated to verify IPC and file operations. The installer wizard itself, macOS/Linux packages, external VS Code windows and private GitHub PR authentication have not been tested. The installer is unsigned; there are no automatic updates.

本机一次 0.3.2 桌面自动化在创建示例时窗口提前关闭，未得到进程错误原因；单独重试示例创建和随后完整 8 组复验均通过。保留这一观察，不能据此认定所有启动环境都已验证。

## 数据与交互

新增覆盖已有分支回滚保护、旧格式迁移快照、未来格式保护、主文件缺失、显式备份恢复、无操作重启、事务对象隔离、并发启动、过期锁、端口绑定失败、请求取消后的退出等待、设置写入失败、非法请求，以及示例设置中断后的继续处理。

浏览器验证包含正常任务全流程，还覆盖保存时继续输入、中英文草稿隔离、缓存写满、切换页面后关闭提示、并发编辑冲突、已有分支选择、键盘搜索、PR 编号检索和重命名差异显示。

## 截图与构建

- [中文桌面工作台](screenshots-v3/desktop-workspace-zh.png)
- [English workspace](screenshots-v3/desktop-workspace-en.png)
- [差异视图](screenshots-v3/desktop-changes-en.png)
- [交接预览](screenshots-v3/desktop-handoff-en.png)
- [桌面设置](screenshots-v3/desktop-settings-en.png)

本地安装包位于 `release/0.3.2/`；使用 `npm run release:manifest` 生成 SHA-256 校验文件及 `release-info.json`。下载入口为 [GitHub Release v0.3.2](https://github.com/xiao-zi-chen/Tandem/releases/tag/v0.3.2)。截图来自实际打包程序；设置截图中的本机数据路径已遮盖。

仓库包含 Windows CI 与手动发布工作流；实际远端执行状态以 [Actions](https://github.com/xiao-zi-chen/Tandem/actions) 为准。本地结果不等同于远端 CI 结果。尚未开展外部团队的长期试用；没有自动发送推广消息。
