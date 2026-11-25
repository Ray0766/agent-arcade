import sampleImage from '../assets/courtyard-inspiration.webp';
import { localizeTree, setAttribute, setText } from './i18n.ts';
import './courtyard-inspiration.css';

const examples = [
  { kind: 'flowers', title: 'Flower pot', tip: 'Set it on the grass beside the path entrance.' },
  { kind: 'lamp', title: 'Lantern', tip: 'Set it farther along the same side, leaving room to walk.' },
  { kind: 'bench', title: 'Bench', tip: 'Set it opposite the lantern, facing the path.' },
] as const;
type CourtyardItem = typeof examples[number]['kind'];

export function createCourtyardInspiration(after: HTMLElement, choose: (kind: CourtyardItem) => void) {
  const open = document.createElement('button');
  open.type = 'button';
  open.id = 'open-courtyard-inspiration';
  open.hidden = true;
  setText(open, 'Courtyard inspiration');
  after.after(open);

  const dialog = document.createElement('dialog');
  dialog.id = 'courtyard-inspiration';
  dialog.setAttribute('aria-labelledby', 'courtyard-inspiration-title');
  dialog.innerHTML = `
    <header>
      <div>
        <h2 id="courtyard-inspiration-title">Courtyard inspiration</h2>
        <p>Leave the stone path clear. Choose one object to preview it before placing it.</p>
      </div>
      <button type="button" class="close">×</button>
    </header>
    <div class="courtyard-inspiration-layout">
      <img width="1000" height="625" loading="lazy">
      <div class="courtyard-inspiration-items"></div>
    </div>
  `;
  document.body.append(dialog);
  const close = dialog.querySelector<HTMLButtonElement>('.close')!;
  setAttribute(close, 'aria-label', 'Close courtyard inspiration');
  close.onclick = () => dialog.close();
  const photo = dialog.querySelector('img')!;
  photo.src = sampleImage;
  setAttribute(photo, 'alt', 'A flower pot and lantern beside the stone path, with a bench across the path.');
  const options = examples.map(({ kind, title, tip }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.kind = kind;
    const label = document.createElement('strong');
    setText(label, title);
    const description = document.createElement('span');
    setText(description, tip);
    button.append(label, description);
    button.onclick = () => choose(kind);
    return button;
  });
  dialog.querySelector('.courtyard-inspiration-items')!.append(...options);
  localizeTree(dialog);
  open.onclick = () => { if (!open.hidden && !open.disabled && !dialog.open) dialog.showModal(); };
  return {
    close: () => dialog.close(),
    update(visible: boolean, available: boolean) {
      open.hidden = !visible;
      open.disabled = !available;
      for (const option of options) option.disabled = !available;
      if (!visible && dialog.open) dialog.close();
    },
  };
}
