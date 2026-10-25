import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon.tsx';

type Option = { value: string; label: ReactNode; group?: string };
type NativeOption = { value?: string; children?: ReactNode; label?: string };
type Props = { value: string; onChange: (value: string) => void; children?: ReactNode; 'aria-label': string };

function readOptions(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<NativeOption>(child)) return [];
    if (child.type === 'optgroup') return readOptions(child.props.children, child.props.label);
    if (child.type !== 'option') return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, group }];
  });
}

export function Dropdown({ value, onChange, children, 'aria-label': name }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [placement, setPlacement] = useState<CSSProperties>({});
  const options = readOptions(children);
  const selected = options.find(option => option.value === value);
  const active = options.find(option => option.value === activeValue) ?? selected ?? options[0];
  const activeIndex = options.findIndex(option => option === active);
  const optionId = (index: number) => `${id}-option-${index}`;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const menu = panel.current;
      if (!rect || !menu) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const maxWidth = Math.max(1, Math.min(320, rightEdge - leftEdge));
      const minWidth = Math.min(192, maxWidth);
      menu.style.minWidth = `${minWidth}px`;
      menu.style.maxWidth = `${maxWidth}px`;
      const width = Math.max(minWidth, Math.min(menu.getBoundingClientRect().width, maxWidth));
      const below = Math.max(0, bottomEdge - rect.bottom - 8);
      const above = Math.max(0, rect.top - topEdge - 8);
      const upwards = below < 180 && above > below;
      const maxHeight = Math.max(1, Math.min(384, bottomEdge - topEdge, upwards ? above : below));
      setPlacement({ minWidth, maxWidth, maxHeight, left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)), ...(upwards ? { bottom: window.innerHeight - Math.min(bottomEdge, rect.top - 8) } : { top: Math.max(topEdge, Math.min(rect.bottom + 8, bottomEdge - maxHeight)) }) });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, id]);

  const show = () => { setActiveValue(selected?.value ?? options[0]?.value ?? null); setOpen(true); };
  const commit = (option: Option | undefined) => {
    if (!option) return;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    onChange(option.value);
  };
  const row = (option: Option, index: number) => <div key={option.value} id={optionId(index)} role="option" aria-selected={option.value === value} data-active={option === active} className="dropdown-option" onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveValue(option.value)} onClick={() => commit(option)}><span className="dropdown-value">{option.label}</span>{option.value === value && <Icon name="check" className="dropdown-check" />}</div>;
  const groups: { label?: string; rows: ReactNode[] }[] = [];
  options.forEach((option, index) => {
    if (!groups.length || groups[groups.length - 1].label !== option.group) groups.push({ label: option.group, rows: [] });
    groups[groups.length - 1].rows.push(row(option, index));
  });

  return <div className="dropdown" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <select className="dropdown-backing" hidden aria-hidden={true} tabIndex={-1} aria-label={name} value={value} onChange={event => onChange(event.currentTarget.value)}>{children}</select>
    <button ref={trigger} type="button" className="dropdown-trigger" role="combobox" aria-label={name} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined} onClick={() => { if (open) setOpen(false); else show(); }} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
      if (event.key === 'Tab') { setOpen(false); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open) commit(active); else show(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (!open) { show(); if (event.key === 'Home' || event.key === 'End') setActiveValue((event.key === 'Home' ? options[0] : options.at(-1))?.value ?? null); return; }
      const index = options.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setActiveValue(options[next]?.value ?? null);
    }}><span className="dropdown-value">{selected?.label ?? (value || 'No options')}</span><Icon name="chevronDown" className="dropdown-chevron" /></button>
    {open && <div ref={panel} id={`${id}-listbox`} role="listbox" aria-label={name} className="dropdown-panel" style={placement}>{groups.map((group, index) => group.label ? <div key={index} role="group" aria-label={group.label}><div className="dropdown-group-label" aria-hidden="true">{group.label}</div>{group.rows}</div> : group.rows)}{!options.length && <div className="dropdown-empty">No options available</div>}</div>}
  </div>;
}
