# 0.4.0 Validation / 验证记录

Date / 日期：2026-10-16。Windows x64、Node.js 24.19.0、Git 2.47.0.windows.2、Electron 44.8.0。

| Check / 项目                                                    | Local result / 本地结果                     |
| --------------------------------------------------------------- | ------------------------------------------- |
| TypeScript, production build, formatting / 类型、生产构建、格式 | Passed / 通过                               |
| Git and business behavior / Git 与业务                          | 19 passed / 通过                            |
| Persistence and lifecycle / 保存、恢复与启停                    | 10 passed / 通过                            |
| Diff parsing and search / 差异解析与检索                        | 6 passed / 通过                             |
| Browser workflows / 浏览器流程                                  | 15 passed / 通过                            |
| Packaged desktop / 实际打包桌面程序                             | 10 verification groups passed / 10 组通过   |
| Windows NSIS installer build / 安装包构建                       | Passed / 通过                               |
| Production dependency audit / 生产依赖审计                      | 0 reported vulnerabilities / 0 个已报告漏洞 |
| Installer signature / 安装包签名                                | NotSigned / 未签名                          |

## New coverage / 本轮新增覆盖

- Real repositories with identically named files display their own contents when switching between groups. / 真实仓库中的同名文件切换后显示各自内容。
- Unified and paired diffs retain source lines, numbering, unequal add/remove blocks, hunk boundaries and missing-newline notices. / 统一与并排差异保留源码、行号、不等长增删块、分块边界与无末尾换行提示。
- Long lines fit inside their columns when wrapping is enabled. Focus mode retains the task title. Narrow windows do not cause horizontal page overflow. / 换行后代码保持在列内；专注视图保留任务标题，窄窗口没有整页横向溢出。
- Refresh leaves the currently displayed diff visible. A delayed response from the previous selection cannot overwrite a different file. / 刷新保留当前差异，旧文件的延迟响应不覆盖新文件。
- A real 1,200-line untracked file begins with 500 rendered rows, expands on request and includes its final line. / 真实 1,200 行未跟踪文件先渲染 500 行，可逐批展开到最后一行。
- Directory IPC resolves the registered binding, rejects arbitrary paths and unknown binding IDs, and displays an OS failure with an actionable message. / 目录 IPC 根据登记的仓库关联解析路径，拒绝任意路径和无效 ID，并显示系统打开失败的具体原因。
- Layout and wrapping preferences survive closing and restarting the application. / 差异布局与换行偏好在关闭重启后保留。

The native rejection test first exposed lost custom Error properties across Electron's context bridge. Returning plain structured rejection values corrected the behavior; the test now passes against the packaged executable.

桌面拒绝请求测试先复现了 Electron 桥接丢失 Error 自定义属性的问题。改用普通结构化错误对象后，实际打包程序的验证通过。

## Packaged application / 成品验证

The final native run used `release/0.4.0/win-unpacked/Tandem.exe` and verified `app.isPackaged === true`. It also covers the isolated renderer, actual sample worktrees, native clipboard and Markdown writes, menus, folder/save-dialog IPC, canceled workspace switching, and persistence of language, tasks, window size and review preferences. Screenshots in `screenshots-v4/` come from this packaged application; the private data path in Settings is masked.

最终运行的是上述实际打包程序，并确认 `app.isPackaged === true`。同时覆盖渲染器隔离、真实示例工作目录、原生剪贴板与 Markdown 写入、菜单和系统对话框调用、取消切换工作台，以及语言、任务、窗口尺寸和阅读偏好的保留。截图来自此成品，设置中的本机路径已遮盖。

- [English review](screenshots-v4/desktop-review-en.png)
- [中文审阅界面](screenshots-v4/desktop-review-zh.png)
- [Task overview / 任务概览](screenshots-v4/desktop-workspace-en.png)

## Limits / 边界

System folder/save-dialog selections and the OS folder-open result are simulated in automated tests. The installer wizard itself is not automated. Private GitHub authentication, external VS Code windows, macOS/Linux installers and sustained use by external teams have not been verified. There is no code signing or automatic updater.

自动测试模拟系统目录/保存对话框的选择结果及打开目录的系统返回值；未自动操作安装向导。尚未验证私有 GitHub 认证、外部 VS Code 窗口、macOS/Linux 安装包和外部团队长期使用。没有代码签名或自动更新。

GitHub's clean Windows environment runs its own checks on each push. See [Actions](https://github.com/xiao-zi-chen/Tandem/actions) for the remote result; local results are not substituted for CI. Earlier validation is retained in [0.3.2](VALIDATION-0.3.2.md).

每次推送会触发 GitHub 全新 Windows 环境的独立检查，远端状态以上述 Actions 页面为准；本地通过不代替远端结果。此前记录保留在 0.3.2 文档中。
