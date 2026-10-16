import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react';
import { RequestError } from './api';
import type { Messages } from './i18n';

export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-hidden="true" />;
}

export function ErrorMessage({ error, t }: { error: unknown; t: Messages }) {
  if (!error) return null;
  const value = error as RequestError;
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={17} />
      <div>
        {t.errors[value.code as keyof typeof t.errors] || t.errorGeneric}
        {value.details && (
          <details>
            <summary>{t.detail}</summary>
            <pre>{value.details}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  t,
  children,
  wide = false,
  busy = false,
  className = '',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  t: Messages;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      // Preserve a focus choice already made by the user inside the dialog.
      if (ref.current?.contains(document.activeElement)) return;
      (
        ref.current?.querySelector<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), [data-autofocus]',
        ) || ref.current?.querySelector<HTMLElement>('button:not([disabled])')
      )?.focus();
    }, 50);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key === 'Tab') {
        const nodes = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
          ) || []),
        ].filter((el) => el.offsetParent !== null);
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || !ref.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''} ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label={t.close}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status">
      <span>
        <Check size={15} />
      </span>
      {text}
    </div>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <i />
      <i />
      <b />
    </span>
  );
}
