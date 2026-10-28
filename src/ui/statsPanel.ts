import { measure, setDimension, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

const AXES = ['X', 'Y', 'Z'] as const;
const fmt = (n: number) => String(Math.round(n * 1e5) / 1e5);

export interface StatsPanel {
  toggle(): void;
  isOpen(): boolean;
}

/** Shows the size of the selection (or of the whole layer) and lets you type a new one, scaling it about its centre. */
export function createStatsPanel(state: ModelerState, host: HTMLElement, onToggle: () => void = () => {}): StatsPanel {
  const el = document.createElement('div');
  el.className = 'numeric stats';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span data-title>Stats</span><button data-act="close" title="Close (J)">×</button></div>
    <div class="numeric-row">${AXES.map((a, i) => `<label>${a}<input data-i="${i}" inputmode="decimal" spellcheck="false"></label>`).join('')}</div>
    <label class="stats-lock"><input type="checkbox" data-lock> Keep proportions</label>
    <div class="position-size" data-info></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const inputs = [...el.querySelectorAll<HTMLInputElement>('input[data-i]')];
  const lock = el.querySelector<HTMLInputElement>('[data-lock]')!;
  const title = el.querySelector<HTMLElement>('[data-title]')!;
  const info = el.querySelector<HTMLElement>('[data-info]')!;
  const msg = el.querySelector<HTMLElement>('.msg')!;
  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  const show = (refresh?: HTMLInputElement) => {
    if (el.hidden) return;
    const m = measure(state);
    title.textContent = !m ? 'Stats' : m.ofSelection ? 'Size of selection' : 'Size of layer';
    info.textContent = m ? `${m.points} points · ${m.polygons} polygons` : 'Empty layer';
    inputs.forEach((input, i) => {
      input.disabled = !m || m.size[i]! === 0;
      if (input === document.activeElement && input !== refresh) return;
      input.value = m ? fmt(m.size[i]!) : '';
      input.classList.remove('invalid');
    });
  };

  const commit = (input: HTMLInputElement) => {
    const n = input.value.trim() === '' ? NaN : Number(input.value);
    input.classList.toggle('invalid', !(Number.isFinite(n) && n > 0));
    const result = setDimension(state, Number(input.dataset.i) as 0 | 1 | 2, n, lock.checked);
    say(result.ok || result.message === 'That is its size already' ? '' : result.message, !result.ok && result.message !== 'That is its size already');
    show(input);
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

  function toggle(): void {
    el.hidden = !el.hidden;
    show();
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden };
}
