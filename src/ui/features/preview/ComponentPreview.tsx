import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { UserMenu } from '../../components/UserMenu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Badge } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Pagination } from '../../components/Pagination.tsx';
import { Dropdown } from '../../components/Dropdown.tsx';
import { useFocusIntent } from '../../shared/useFocusIntent.ts';

const samples = Array.from({ length: 8 }, (_, index) => `Preview sample item ${index + 1}`);
const pageSize = 3;
const dropdownSamples = Array.from({ length: 30 }, (_, index) => `Preview option ${index + 1}`);
const longContent = 'A long repository and issue title can span several lines while preserving every word and remaining readable on a narrow screen. This isolated sample also includes an unbroken identifier: requirement_0123456789abcdefghijklmnopqrstuvwxyz_0123456789abcdefghijklmnopqrstuvwxyz_0123456789abcdefghijklmnopqrstuvwxyz.';

export function ComponentPreview() {
  useFocusIntent();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [activations, setActivations] = useState(0);
  const [choice, setChoice] = useState('first');
  const [longChoice, setLongChoice] = useState('0');
  const [dialogChoice, setDialogChoice] = useState('first');
  return <main id="main-content" className="component-preview" tabIndex={-1}>
    <header><div className="preview-heading"><div><span className="eyebrow">LOCAL DEVELOPMENT</span><h1>Component preview</h1></div><UserMenu /></div><p>Shared production primitives with isolated static samples. No backend is needed.</p></header>
    <section aria-label="Buttons"><h2>Buttons</h2><div className="preview-actions"><Button onClick={() => setActivations(value => value + 1)}>Preview action</Button><Button disabled>Disabled action</Button><Button loading>Loading action</Button><Button className="icon-button" aria-label="Icon action" onClick={() => setActivations(value => value + 1)}><Icon name="check" /></Button></div><p role="status">Local activations: {activations}</p></section>
    <section aria-label="Badges"><h2>Badges</h2><Badge className="status-pill in_progress" aria-label="Sample issue status"><span className="status-dot in_progress" aria-hidden="true" />In progress</Badge></section>
    <section aria-label="Dropdowns"><h2>Dropdowns</h2><p>Open deliberately with a click, Enter, Space or an arrow. Navigate before selecting; Escape and Tab dismiss.</p><div className="preview-dropdowns"><Dropdown aria-label="Preview selection" value={choice} onChange={setChoice}><option value="first">First choice</option><option value="second">Second choice</option></Dropdown><Dropdown aria-label="Preview long options" value={longChoice} onChange={setLongChoice}>{dropdownSamples.map((label, index) => <option key={label} value={String(index)}>{index === 1 ? longContent : label}</option>)}</Dropdown><Dropdown aria-label="Preview empty options" value="" onChange={() => {}} /></div><p role="status">Local selection: {choice}</p></section>
    <section aria-label="Themed scrolling"><h2>Themed scrolling</h2><div className="preview-scroll" tabIndex={0} aria-label="Scrollable sample content">{dropdownSamples.map(label => <p key={label}>{label} · {longContent}</p>)}</div></section>
    <section aria-label="Empty state"><h2>Empty state</h2><EmptyState icon="issues" title="No sample items"><p>Choose a different collection or clear the local filters.</p></EmptyState></section>
    <section aria-label="Loading state"><h2>Loading state</h2><EmptyState loading role="status" title="Loading samples…"><p>A static pending read example.</p></EmptyState></section>
    <section aria-label="Error state"><h2>Error state</h2><EmptyState icon="database" title="Couldn’t load samples"><p className="form-error" role="alert">Sample read failed. Try the local action again.</p></EmptyState></section>
    <section aria-label="Long content"><h2>Long content</h2><p aria-label="Long content sample">{longContent}</p></section>
    <section aria-label="Modal"><h2>Modal</h2><Button onClick={() => setOpen(true)}>Open preview dialog</Button>{open && <Modal title="Preview dialog" onDismiss={() => setOpen(false)}><div className="detail-body"><p>{longContent}</p><Dropdown aria-label="Preview dialog selection" value={dialogChoice} onChange={setDialogChoice}><option value="first">First dialog choice</option><option value="second">Second dialog choice</option></Dropdown><p>Use Tab, Shift+Tab, Escape or Close to inspect the shared focus behavior.</p></div></Modal>}</section>
    <section aria-label="Pagination"><h2>Pagination</h2><ul aria-label="Sample items">{samples.slice((page - 1) * pageSize, page * pageSize).map(item => <li key={item}>{item}</li>)}</ul><Pagination label="Sample pages" total={samples.length} page={page} pageSize={pageSize} singular="item" onPage={setPage} /></section>
  </main>;
}
