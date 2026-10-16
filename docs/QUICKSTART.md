# Quick start

[Home](../README.md) · [简体中文](QUICKSTART.zh-CN.md) · [All documentation](README.md)

Tandem groups the work for one task across independent local Git repositories. This guide follows a feature that changes both a frontend and an API.

## 1. Install and check Git

Download the **Windows x64 installer** from [Tandem 0.4.0](https://github.com/xiao-zi-chen/Tandem/releases/tag/v0.4.0). Close older versions, run the installer, then open Tandem. The preview installer is unsigned; automatic updates are not available.

Git must be installed and available on PATH. **Settings** shows the detected version. If it is missing, install [Git for Windows](https://git-scm.com/downloads/win), restart Tandem, and check again. You do not need Node.js or Python to use the desktop app.

The release includes `SHA256SUMS.txt` and `release-info.json`. To compare the downloaded installer's hash with the published checksum, run PowerShell in your download folder:

```powershell
Get-FileHash .\Tandem-Setup-0.4.0-x64.exe -Algorithm SHA256
```

## 2. Try the sample or connect your repositories

**Open sample workspace** creates two real local Git repositories and three tasks. Explore **Add annual billing** to see changes in both repositories. The sample demonstrates Git workflows; it is not a runnable full-stack application.

For your own work, open **Repositories → Connect repository**. Select an existing local Git repository with the folder picker or paste its absolute path. Repeat for your API and frontend repositories. Clone remote repositories with your usual Git tool first.

Save a **Repository set** if you often use the same combination. When starting another task, you can choose the repositories you need from that set.

## 3. Create the task workspace

Choose **New task**, give it a concrete name such as `Add annual billing`, and select the repositories.

| Mode              | Use it when                                        | What happens                                                                                                          |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **New worktrees** | You want separate working directories for the task | Tandem creates a worktree per repository. Choose a base and a new branch, or use an existing unoccupied local branch. |
| **Existing work** | You have already started in existing checkouts     | Tandem groups the selected directories in place, including their local changes.                                       |

For new worktrees, you can use the same branch name across repositories, such as `feature/annual-billing`. Each remains a separate Git branch in its own repository. An existing branch must not be checked out in another worktree.

Open the task in **VS Code**, or use the folder and copy-path actions to work in your usual editor. Install dependencies and configure ports or databases as your projects require. A worktree is a Git working directory; it does not provide runtime isolation.

## 4. Review the changes together

Open **Changes → All repositories** to browse the task's files grouped by repository. Filter by repository name or by a file's old or current path.

- **Working tree** shows local changes, with staged and untracked files distinguished. **Since task base** shows committed changes relative to the recorded task base.
- Switch between unified and side-by-side diffs. Enable line wrapping for long lines, or focus on changes to give the code more space.
- Use the arrow keys in the file list or the previous/next buttons to move between files.
- Large diffs initially show 500 display rows. Choose **Show more lines** to expand them. Git output limits still apply.

Layout and wrapping preferences survive a restart. Commit and push with your existing Git tools.

## 5. Link PRs and hand off

Create PRs through GitHub or your existing tools, then link their GitHub URLs to the task. Refresh their status when needed. Tandem uses an existing `gh` login where available; a status it cannot verify stays **Unverified**. Private GitHub authentication has not been verified for this preview.

Keep the task's notes and checklist up to date. Choose **Export handoff** to preview a Markdown summary, then copy it or save it through the native dialog. Review local paths and notes before sharing it. The export does not include uncommitted file contents; commit and push code you want someone else to pick up.

Archive the task when finished. Archiving hides it from the active task list and keeps its files, branches, and worktrees. Restore it from **Archive** when needed. Use your usual Git tools for worktree cleanup.

## Shortcuts and preferences

| Action                                 | How                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Find a task                            | **Ctrl+K**, then search its name, repository, branch, or linked PR; combine terms such as `web #123` |
| Open a search result                   | Arrow keys, then **Enter**                                                                           |
| Switch language                        | **中文 / EN** in the sidebar                                                                         |
| Inspect Git version or data location   | **Settings**                                                                                         |
| Open a different Tandem data directory | **Settings → Open another workspace…**                                                               |

## Common problems

| Problem                      | Next step                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Git is unavailable           | Confirm `git --version` works in a new terminal, then restart Tandem.                                                                     |
| A branch is already occupied | Choose another branch or attach its existing checkout instead.                                                                            |
| VS Code cannot be opened     | Use **Download workspace file** and open it in your editor, or open the worktree folder directly.                                         |
| A PR is unverified           | Check the URL, network, and any existing `gh` login. The label is not evidence that the PR is open, closed, or merged.                    |
| A data folder is rejected    | Choose an empty folder or a valid existing Tandem data directory. An ordinary nonempty project folder cannot be used as a data directory. |
| Startup offers recovery      | Read [Data and recovery](DATA.md). Keep the existing data directory; do not delete it to reset the app.                                   |

[Report a reproducible problem](https://github.com/xiao-zi-chen/Tandem/issues/new?template=bug_report.yml) with the Tandem version, Windows version, Git version, and steps. Remove credentials, private paths, and source code from screenshots or logs.
