# Data and recovery

[Home](../README.md) · [简体中文](DATA.zh-CN.md) · [Quick start](QUICKSTART.md)

Tandem stores workspace metadata locally. Its data directory also contains real task worktrees, so treat it as working project data.

## Where data lives

The desktop app defaults to the current user's application-data location. Open **Settings → Data directory** to inspect the actual path. Do not assume it is next to the installer or source checkout.

```text
data/
  state.json          repositories, tasks, and operation journal
  state.backup.json   previous valid metadata snapshot
  workspaces/         real task worktrees and editor workspace files
  sample-project/     optional sample repositories
```

Repositories connected from elsewhere stay at their original paths. Attached checkouts remain in place. Worktrees created for a task are real Git working directories associated with their original repositories.

## What is protected

- Metadata is validated, synced to a temporary file, and atomically replaced. The previous valid metadata snapshot is retained.
- Note drafts survive task navigation. Saving checks the task revision to avoid silently overwriting a concurrent edit.
- Interrupted worktree creation is recorded in an operation journal. Recovery removes only unchanged resources created by that operation; existing branches and new work are preserved.
- Invalid state is preserved instead of silently reset.

**The metadata snapshot is not a backup of source code, uncommitted files, or note drafts.** Back up your project data separately. Do not delete the data directory to reset the interface. Linked worktrees also depend on their original repositories; moving or deleting either directory can break the relationship.

## Recovering metadata

If the primary state is missing or invalid, the desktop app validates the backup before offering **Restore backup and restart**. The damaged original is retained. A restored snapshot may be older than the latest task changes; review the task list and working directories afterward.

If an interrupted operation is shown, use **Check and recover** and review the result. Resources with new work are kept. If recovery cannot complete, retain the directory and [report the error](https://github.com/xiao-zi-chen/Tandem/issues/new?template=bug_report.yml) with private data removed from the report.

## Switching workspaces

Choose **Settings → Open another workspace…**, then select an existing Tandem data directory or an empty folder. Ordinary nonempty project folders and workspaces already in use are rejected. This switches the data directory; it does not move repositories or worktrees.

For an older browser preview, keep its `.tandem/` directory. Close any service using it, then select that directory in the desktop app. The existing `启动同序.cmd` source launcher prefers a desktop build and falls back to the browser preview if that build is unavailable; installer users do not need this launcher.

## Upgrading and archiving

Close the running app before installing a newer version. **0.4.0 uses data format 2**, the same as 0.3. Older format-1 workspaces migrate on the first mutation, retaining an original `state.v1.backup.json`. Continue using version 0.3 or newer after migration.

Archiving a task hides it from the active list. It does not delete its worktrees or branches. The installer is configured to retain application data on uninstall; keep your own backups and never use uninstallation as a way to clean up Git worktrees.

For implementation details and verification limits, see [Architecture](ARCHITECTURE.md), [Reliability](RELIABILITY-0.3.md), and [Validation](VALIDATION.md).
