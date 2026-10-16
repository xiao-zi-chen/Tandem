# Unreleased / 尚未发布

[Documentation / 文档](README.md) · [Current Windows preview / 当前 Windows 预览版](https://github.com/xiao-zi-chen/Tandem/releases/tag/v0.4.0)

These changes are on `main` after the 0.4.0 release. The published 0.4.0 installer has not been replaced.

以下改进位于 0.4.0 发布后的 `main` 分支，已发布的 0.4.0 安装包没有替换。

## Fixed / 修复

- Preserve a user's chosen focus inside a dialog when delayed initial focus runs. Quickly selecting a search result with the keyboard no longer sends focus back to the input. A controlled-clock regression check covers that timing. / 弹窗延迟初始化焦点时保留用户已选择的焦点；快速用键盘选中搜索结果后，焦点不再被拉回输入框。回归检查通过受控时钟覆盖这一时序。

## Repository / 仓库

- Reworked English and Chinese READMEs with actual screenshots, download links, and workflow guidance. / 重整中英文 README，展示真实界面、下载入口与工作流程。
- Added bilingual quick-start and data-recovery guides, feedback forms, and documentation link checks in CI. / 增加中英文上手与数据恢复指南、反馈表单，以及 CI 文档链接检查。
