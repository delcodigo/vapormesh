import { selectionPosition, setSelectionPosition, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

const AXES = ['X', 'Y', 'Z'] as const;
// enough digits to see a value like 0.3 rather than 0.30000000000000004, and still tell 0.12345 from 0.12346
const fmt = (n: number) => String(Math.round(n * 1e5) / 1e5);

export interface PositionPanel {
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Shows where the selected points are and lets you type a new position. One point: its X, Y and Z. Several: the centre of
 * their box (typing moves them all), with the box's size underneath.
 */
export function createPositionPanel(state: ModelerState, host: HTMLElement, onToggle: () => void = () => {}): PositionPanel {
  const el = document.createElement('div');
  el.className = 'numeric position';
  el.innerHTML = `
    <div class="numeric-title"><span data-title>Position</span><button data-act="close" title="Close (I)">×</button></div>
    <div class="numeric-row">${AXES.map((a, i) => `<label>${a}<input data-i="${i}" inputmode="decimal" spellcheck="false"></label>`).join('')}</div>
    <div class="position-size" data-size></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const inputs = [...el.querySelectorAll<HTMLInputElement>('input')];
  const title = el.querySelector<HTMLElement>('[data-title]')!;
  const size = el.querySelector<HTMLElement>('[data-size]')!;
  const msg = el.querySelector<HTMLElement>('.msg')!;
  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  /** Show the selection's position, leaving alone a field the person is typing in. */
  const show = (refresh?: HTMLInputElement) => {
    if (el.hidden) return;
    const here = selectionPosition(state);
    title.textContent = !here ? 'Position' : here.points === 1 ? 'Position (1 point)' : `Center of ${here.points} points`;
    size.textContent = here && here.points > 1 ? `Size ${here.size.map(fmt).join(' × ')}` : '';
    inputs.forEach((input, i) => {
      input.disabled = !here;
      if (input === document.activeElement && input !== refresh) return;
      input.value = here ? fmt(here.position[i]!) : '';
      input.classList.remove('invalid');
    });
  };

  const commit = (input: HTMLInputElement) => {
    const i = Number(input.dataset.i) as 0 | 1 | 2;
    const text = input.value.trim();
    const n = text === '' ? NaN : Number(text);
    input.classList.toggle('invalid', !Number.isFinite(n));
    if (!Number.isFinite(n)) return say('Type a number', true);
    const result = setSelectionPosition(state, i, n);
    // "already there" is not worth a message: it happens whenever you tab through the fields
    say(result.ok ? '' : result.message === 'That is where it already is' ? '' : result.message, !result.ok);
    show(input); // show what it came to, which can differ from what was typed (e.g. 0.30000001)
  };
  for (const input of inputs) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit(input);
      if (e.key === 'Escape') {
        input.blur();
        show(input);
      }
    });
    input.addEventListener('change', () => commit(input));
    input.addEventListener('input', () => input.classList.remove('invalid'));
    input.addEventListener('blur', () => queueMicrotask(() => show()));
  }
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="close"]')) toggle();
  });

  state.subscribe(() => {
    say('');
    show();
  });
  show();

  function toggle(): void {
    el.hidden = !el.hidden;
    show();
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden };
}
