import { Button } from './Button.tsx';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

export function Modal({ title, children, onDismiss, wide = false }: { title: string; children: ReactNode; onDismiss: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    dialog.autofocus = true;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);

  return <dialog ref={ref} className={wide ? 'modal diagnostics-modal' : 'modal'} aria-labelledby={titleId} tabIndex={-1} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')].filter(control => control.getClientRects().length > 0);
    event.preventDefault();
    if (!controls.length) { event.currentTarget.focus(); return; }
    const index = controls.findIndex(control => control === document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
    controls[next].focus();
  }} onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    <header className="modal-header"><div><span className="eyebrow">LOCAL WORKSPACE</span><h2 id={titleId}>{title}</h2></div><Button type="button" className="icon-button" aria-label="Close dialog" onClick={onDismiss}><Icon name="close" /></Button></header>
    {children}
  </dialog>;
}
