import sampleImage from '../assets/courtyard-inspiration.webp';
import flowerCornerImage from '../assets/courtyard-flower-corner.webp';
import type { BuildKind } from '../shared/planets.ts';
import { localizeTree, setAttribute, setText } from './i18n.ts';
import './courtyard-inspiration.css';

const examples = [{
  title: 'Pathside welcome', image: sampleImage,
  alt: 'A flower pot and lantern beside the stone path, with a bench across the path.',
  items: [
    { kind: 'flowers', title: 'Flower pot', tip: 'Set it on the grass beside the path entrance.' },
    { kind: 'lamp', title: 'Lantern', tip: 'Set it farther along the same side, leaving room to walk.' },
    { kind: 'bench', title: 'Bench', tip: 'Set it opposite the lantern, facing the path.' },
  ],
}, {
  title: 'Flower-viewing corner', image: flowerCornerImage,
  alt: 'Two pots at different heights on the grass beside the open stone path, with a lantern set back.',
  items: [
    { kind: 'flowers', title: 'Front flower pot', tip: 'Place it on lower grass beside the path, near the entrance.' },
    { kind: 'flowers', title: 'Raised flower pot', tip: 'Place the same pot on higher grass, a little farther from the path.' },
    { kind: 'lamp', title: 'Lantern', tip: 'Set the lantern behind the pots. Leave the stone path clear from end to end.' },
  ],
}] as const;

export function createCourtyardInspiration(after: HTMLElement, choose: (kind: BuildKind) => void) {
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
    <div class="courtyard-inspiration-examples" role="group" aria-label="Courtyard examples"></div>
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
  const items = dialog.querySelector('.courtyard-inspiration-items')!;
  const selector = dialog.querySelector('.courtyard-inspiration-examples')!;
  let options: HTMLButtonElement[] = [];
  let available = false;
  const selectors = examples.map(example => {
    const button = document.createElement('button');
    button.type = 'button';
    setText(button, example.title);
    button.onclick = () => show(example);
    return button;
  });
  function show(example: typeof examples[number]) {
    selectors.forEach((button, index) => button.setAttribute('aria-pressed', String(examples[index] === example)));
    photo.src = example.image;
    setAttribute(photo, 'alt', example.alt);
    options = example.items.map(({ kind, title, tip }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.kind = kind;
      button.disabled = !available;
      const label = document.createElement('strong');
      setText(label, title);
      const description = document.createElement('span');
      setText(description, tip);
      button.append(label, description);
      button.onclick = () => choose(kind);
      return button;
    });
    items.replaceChildren(...options);
  }
  selector.append(...selectors);
  show(examples[0]);
  localizeTree(dialog);
  open.onclick = () => { if (!open.hidden && !open.disabled && !dialog.open) dialog.showModal(); };
  return {
    close: () => dialog.close(),
    update(visible: boolean, canPlace: boolean) {
      available = canPlace;
      open.hidden = !visible;
      open.disabled = !available;
      for (const option of options) option.disabled = !available;
      if (!visible && dialog.open) dialog.close();
    },
  };
}
