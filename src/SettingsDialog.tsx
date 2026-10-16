import { APP_VERSION } from '../shared/version';
import { useEffect, useState } from 'react';
import { ExternalLink, FolderOpen, Monitor, Terminal } from 'lucide-react';
import type { DesktopInfo } from '../shared/desktop';
import type { Locale } from '../shared/types';
import { ErrorMessage, Modal, Spinner } from './components';
import type { Messages } from './i18n';
import { hasUnsavedNotes } from './useNoteDraft';

export function SettingsDialog({
  t,
  locale,
  onLocale,
  onClose,
}: {
  t: Messages;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<DesktopInfo>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    window.tandem?.info().then(setInfo).catch(setError);
  }, []);
  return (
    <Modal title={t.settings} {...{ t, onClose }}>
      <div className="modal-body settings-body">
        <div className="setting-row">
          <span>{t.language}</span>
          <select
            value={locale}
            onChange={(e) => onLocale(e.target.value as Locale)}
            aria-label={t.language}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <section className="settings-section">
          <h3>
            <Monitor size={16} />
            {t.appInfo}
          </h3>
          <dl>
            <div>
              <dt>Tandem</dt>
              <dd>{info?.version || APP_VERSION}</dd>
            </div>
            <div>
              <dt>{t.system}</dt>
              <dd>
                {window.tandem
                  ? `${t.desktopVersion} · ${info?.platform || 'Windows'}`
                  : t.browserVersion}
              </dd>
            </div>
            {window.tandem && (
              <div>
                <dt>
                  <Terminal size={14} />
                  Git
                </dt>
                <dd>{info ? info.gitVersion || t.gitUnavailable : <Spinner size={14} />}</dd>
              </div>
            )}
          </dl>
        </section>
        {window.tandem && (
          <section className="settings-section">
            <h3>
              <FolderOpen size={16} />
              {t.dataDirectory}
            </h3>
            <p className="settings-path mono">{info?.dataDirectory || '…'}</p>
            <div className="settings-actions">
              <button
                className="button secondary"
                onClick={() => window.tandem!.revealDataDirectory().catch(setError)}
              >
                <ExternalLink size={14} />
                {t.revealData}
              </button>
              <button
                className="button secondary"
                disabled={hasUnsavedNotes()}
                title={hasUnsavedNotes() ? t.unsavedNote : undefined}
                onClick={() => window.tandem!.switchDataDirectory().catch(setError)}
              >
                {t.switchWorkspace}
              </button>
            </div>
            <p className="muted">{t.switchWorkspaceHelp}</p>
          </section>
        )}
        <section className="settings-section">
          <h3>
            <ExternalLink size={16} />
            {t.projectLinks}
          </h3>
          <div className="settings-actions">
            <a
              className="button secondary"
              href="https://github.com/xiao-zi-chen/Tandem/releases"
              target="_blank"
              rel="noreferrer"
            >
              {t.releaseNotes}
            </a>
            <a
              className="button secondary"
              href="https://github.com/xiao-zi-chen/Tandem/issues/new/choose"
              target="_blank"
              rel="noreferrer"
            >
              {t.reportIssue}
            </a>
          </div>
        </section>
        <ErrorMessage {...{ error, t }} />
      </div>
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          {t.close}
        </button>
      </footer>
    </Modal>
  );
}
