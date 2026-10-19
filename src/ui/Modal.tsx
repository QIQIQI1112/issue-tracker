import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export function Modal({ title, children, onDismiss, pending = false, wide = false }: { title: string; children: ReactNode; onDismiss: () => void; pending?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
      else document.getElementById('new-issue')?.focus();
    };
  }, []);

  return <dialog ref={ref} className={wide ? 'modal diagnostics-modal' : 'modal'} aria-labelledby={titleId} aria-busy={pending} tabIndex={-1} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')].filter(control => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
  }} onCancel={(event) => { event.preventDefault(); if (!pending) onDismiss(); }}>
    <header className="modal-header"><div><span className="eyebrow">LOCAL WORKSPACE</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onDismiss} disabled={pending}><Icon name="close" /></button></header>
    {children}
  </dialog>;
}
