import { Copy, FolderOpen } from 'lucide-react';
import type { Binding } from '../shared/types';
import { copyText } from './api';
import type { Messages } from './i18n';

export function WorktreeActions({
  taskId,
  binding,
  t,
  notify,
  onError,
}: {
  taskId: string;
  binding: Binding;
  t: Messages;
  notify: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <div className="worktree-actions">
      <button
        className="icon-button"
        title={t.copyWorktreePath}
        aria-label={t.copyWorktreePath}
        onClick={() => {
          onError(undefined);
          void copyText(binding.worktreePath)
            .then(() => notify(t.copied))
            .catch(onError);
        }}
      >
        <Copy size={14} />
      </button>
      {window.tandem && (
        <button
          className="icon-button"
          title={t.openWorktree}
          aria-label={t.openWorktree}
          onClick={() => {
            onError(undefined);
            void window.tandem!.openWorktree({ taskId, bindingId: binding.id }).catch(onError);
          }}
        >
          <FolderOpen size={15} />
        </button>
      )}
    </div>
  );
}
