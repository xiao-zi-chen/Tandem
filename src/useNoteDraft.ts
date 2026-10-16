import { useEffect, useState } from 'react';
import { readLocal, writeLocal, removeLocal } from './storage';

interface Draft {
  key: string;
  text: string;
  baseText: string;
  baseRevision: number;
}
const sessionDrafts = new Map<string, Draft>();
const activeDirty = new Set<string>();
const unpersisted = new Set<string>();
export const hasUnsavedNotes = () => activeDirty.size > 0 || unpersisted.size > 0;

function read(key: string, description: string, revision: number): Draft {
  try {
    const value = sessionDrafts.get(key) || JSON.parse(readLocal(key) || 'null');
    if (
      value &&
      typeof value.text === 'string' &&
      typeof value.baseText === 'string' &&
      Number.isInteger(value.baseRevision) &&
      value.text !== description
    )
      return { key, text: value.text, baseText: value.baseText, baseRevision: value.baseRevision };
  } catch {
    /* Malformed drafts never replace saved notes. */
  }
  return { key, text: description, baseText: description, baseRevision: revision };
}

export function useNoteDraft(
  taskId: string,
  locale: string,
  description: string,
  revision: number,
) {
  const key = `tandem.note.${taskId}.${locale}`;
  const [draft, setDraft] = useState<Draft>(() => read(key, description, revision));
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    setDraft((current) => {
      if (current.key !== key) return read(key, description, revision);
      // A response older than an acknowledged save must not roll the note back.
      if (revision < current.baseRevision) return current;
      if (current.text === current.baseText || current.text === description)
        return { key, text: description, baseText: description, baseRevision: revision };
      if (description === current.baseText) return { ...current, baseRevision: revision };
      return current;
    });
  }, [key, description, revision]);
  const current = draft.key === key ? draft : read(key, description, revision);
  const dirty = current.text !== (revision < current.baseRevision ? current.baseText : description);
  useEffect(() => {
    // Do not write the old language's draft into a newly selected language key.
    if (draft.key !== key) return;
    if (dirty) {
      sessionDrafts.set(key, structuredClone(draft));
      const saved = writeLocal(key, JSON.stringify(draft));
      setStorageFailed(!saved);
      if (saved) unpersisted.delete(key);
      else unpersisted.add(key);
      activeDirty.add(key);
    } else {
      sessionDrafts.delete(key);
      unpersisted.delete(key);
      activeDirty.delete(key);
      removeLocal(key);
      setStorageFailed(false);
    }
    return () => {
      activeDirty.delete(key);
    };
  }, [key, draft, dirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || unpersisted.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  return {
    text: current.text,
    dirty,
    storageFailed,
    baseRevision: current.baseRevision,
    remotelyChanged: dirty && description !== current.baseText && revision >= current.baseRevision,
    setText(text: string) {
      setDraft((old) => {
        const value = old.key === key ? old : read(key, description, revision);
        return {
          ...value,
          text,
          ...(value.text === description ? { baseText: description, baseRevision: revision } : {}),
        };
      });
    },
    saved(submitted: string, savedRevision: number) {
      setDraft((current) =>
        current.key === key
          ? { ...current, baseText: submitted, baseRevision: savedRevision }
          : current,
      );
      // The effect retains any typing that happened after this save was submitted.
    },
    discard() {
      removeLocal(key);
      sessionDrafts.delete(key);
      unpersisted.delete(key);
      setDraft({ key, text: description, baseText: description, baseRevision: revision });
    },
  };
}
