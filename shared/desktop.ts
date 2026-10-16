import type { Locale } from './types';

export interface DesktopPreferences {
  locale?: Locale;
  selectedTaskId?: string;
}

export interface DesktopInfo {
  version: string;
  platform: string;
  dataDirectory: string;
  gitVersion: string | null;
  packaged: boolean;
}

export type DesktopAction = 'new-task' | 'connect-repository' | 'search' | 'settings' | 'guide';

export interface DesktopBridge {
  readonly runtime: { sandboxed: boolean; contextIsolated: boolean };
  preferences(): Promise<DesktopPreferences>;
  savePreferences(patch: DesktopPreferences): Promise<void>;
  chooseRepository(): Promise<string | null>;
  saveFile(request: { name: string; content: string }): Promise<boolean>;
  copyText(text: string): Promise<void>;
  info(): Promise<DesktopInfo>;
  revealDataDirectory(): Promise<void>;
  openWorktree(request: { taskId: string; bindingId: string }): Promise<void>;
  switchDataDirectory(): Promise<boolean>;
  onAction(callback: (action: DesktopAction) => void): () => void;
  onLocale(callback: (locale: Locale) => void): () => void;
}

declare global {
  interface Window {
    tandem?: DesktopBridge;
  }
}
