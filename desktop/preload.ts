import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAction, DesktopBridge, DesktopPreferences } from '../shared/desktop';
import type { Locale } from '../shared/types';

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) {
    const error = Object.assign(new Error(result?.error?.code || 'INTERNAL_ERROR'), {
      code: result?.error?.code || 'INTERNAL_ERROR',
      details: result?.error?.details,
    });
    throw error;
  }
  return result.value;
}

const bridge: DesktopBridge = {
  runtime: {
    sandboxed: process.sandboxed === true,
    contextIsolated: process.contextIsolated === true,
  },
  preferences: () => invoke('tandem:preferences'),
  savePreferences: (patch: DesktopPreferences) => invoke('tandem:preferences:save', patch),
  chooseRepository: () => invoke('tandem:choose-repository'),
  saveFile: (request) => invoke('tandem:save-file', request),
  copyText: (text) => invoke('tandem:copy-text', text),
  info: () => invoke('tandem:info'),
  revealDataDirectory: () => invoke('tandem:reveal-data'),
  switchDataDirectory: () => invoke('tandem:switch-data'),
  onAction: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, action: DesktopAction) => callback(action);
    ipcRenderer.on('tandem:action', handler);
    return () => ipcRenderer.removeListener('tandem:action', handler);
  },
  onLocale: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, locale: Locale) => callback(locale);
    ipcRenderer.on('tandem:locale', handler);
    return () => ipcRenderer.removeListener('tandem:locale', handler);
  },
};

contextBridge.exposeInMainWorld('tandem', Object.freeze(bridge));
