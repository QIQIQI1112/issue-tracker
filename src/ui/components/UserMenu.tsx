import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button.tsx';
import { ThemeSwitch } from './ThemeSwitch.tsx';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="user-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Button ref={trigger} className="user-menu-trigger" aria-label="User menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
        root.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
      }
    }}><span aria-hidden="true">L</span></Button>
    {open && <div className="user-menu-popup" id={id} role="menu" aria-label="User menu" onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) event.preventDefault();
    }}><div className="user-menu-caption">Local workspace</div><div className="user-menu-separator" role="separator" /><ThemeSwitch role="menuitemcheckbox" presentation="menu" /></div>}
  </div>;
}
