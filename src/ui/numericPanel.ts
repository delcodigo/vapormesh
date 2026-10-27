import { makeDraggable } from './draggable';
import { applyNumeric, type ModelerState, type NumericOp, type TransformToolName } from '@/modeler';
import type { Vec3 } from '@/core';

interface OpSpec {
  label: string;
  heading: string;
  defaults: [string, string, string];
  usesPivot: boolean;
}

const OPS: Record<TransformToolName, OpSpec> = {
  move: { label: 'Move', heading: 'Offset', defaults: ['0', '0', '0'], usesPivot: false },
  rotate: { label: 'Rotate', heading: 'Angle (deg, X→Y→Z)', defaults: ['0', '0', '0'], usesPivot: true },
  size: { label: 'Size', heading: 'Factor', defaults: ['1', '1', '1'], usesPivot: true },
};
const OP_NAMES = Object.keys(OPS) as TransformToolName[];

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4);
const row = (field: string) =>
  ['X', 'Y', 'Z']
    .map((a, i) => `<label>${a}<input data-field="${field}" data-i="${i}" inputmode="decimal" spellcheck="false"></label>`)
    .join('');

export interface NumericPanel {
  toggle(): void;
}

/** A floating panel for typing exact Move / Rotate / Size values and placing the pivot. */
export function createNumericPanel(state: ModelerState, host: HTMLElement): NumericPanel {
  const el = document.createElement('div');
  el.className = 'numeric';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Numeric</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-tabs">${OP_NAMES.map((o) => `<button data-op="${o}">${OPS[o].label}</button>`).join('')}</div>
    <div class="numeric-group" data-group="pivot">
      <div class="numeric-heading"><span>Pivot</span><button data-act="center" title="Use the centre of the selection">Center</button></div>
      <div class="numeric-row">${row('pivot')}</div>
    </div>
    <div class="numeric-group">
      <div class="numeric-heading"><span data-heading></span></div>
      <div class="numeric-row">${row('value')}</div>
    </div>
    <div class="numeric-actions"><button data-act="apply">Apply</button><button data-act="reset">Reset</button></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const pivotInputs = [...el.querySelectorAll<HTMLInputElement>('[data-field="pivot"]')];
  const valueInputs = [...el.querySelectorAll<HTMLInputElement>('[data-field="value"]')];
  const tabs = [...el.querySelectorAll<HTMLButtonElement>('[data-op]')];
  const values = Object.fromEntries(OP_NAMES.map((o) => [o, [...OPS[o].defaults]])) as Record<TransformToolName, string[]>;
  let op: TransformToolName = 'move';
  let lastTool = state.activeTool;

  const parse = (inputs: HTMLInputElement[]): Vec3 | null => {
    const nums = inputs.map((i) => (i.value.trim() === '' ? NaN : Number(i.value)));
    inputs.forEach((i, k) => i.classList.toggle('invalid', !Number.isFinite(nums[k]!)));
    return nums.every(Number.isFinite) ? (nums as Vec3) : null;
  };

  const showOp = (next: TransformToolName) => {
    op = next;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.op === op));
    q('[data-group="pivot"]').hidden = !OPS[op].usesPivot;
    q('[data-heading]').textContent = OPS[op].heading;
    valueInputs.forEach((input, i) => {
      input.value = values[op][i]!;
      input.classList.remove('invalid');
    });
    state.setNumericOp(op);
  };

  /** Mirror the effective pivot into the fields, unless the user is typing in one. */
  const syncPivot = () => {
    if (pivotInputs.includes(document.activeElement as HTMLInputElement)) return;
    const pivot = state.pivot();
    pivotInputs.forEach((input, i) => {
      input.value = pivot ? fmt(pivot[i]!) : '';
      input.classList.remove('invalid');
    });
  };

  const apply = () => {
    const nums = parse(valueInputs);
    if (!nums) return;
    const pivot = state.pivot();
    let numeric: NumericOp;
    if (op === 'move') numeric = { kind: 'move', offset: nums };
    else if (!pivot) return;
    else if (op === 'rotate') numeric = { kind: 'rotate', pivot, degrees: nums };
    else numeric = { kind: 'size', pivot, factors: nums };
    applyNumeric(state, numeric);
  };

  valueInputs.forEach((input, i) => {
    input.addEventListener('input', () => (values[op][i] = input.value));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
  });
  pivotInputs.forEach((input) => {
    input.addEventListener('input', () => {
      const pivot = parse(pivotInputs);
      if (pivot) state.setPivot(pivot);
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  });
  tabs.forEach((t) => t.addEventListener('click', () => showOp(t.dataset.op as TransformToolName)));

  const actions: Record<string, () => void> = {
    close: () => toggle(),
    apply,
    center: () => state.setPivot(null),
    reset: () => {
      values[op] = [...OPS[op].defaults];
      showOp(op);
    },
  };
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) actions[act]!();
  });

  state.subscribe(() => {
    if (el.hidden) return;
    syncPivot();
    // Picking a tool while the panel is open switches the panel to it.
    if (state.activeTool && state.activeTool !== lastTool && state.activeTool in OPS) showOp(state.activeTool as TransformToolName);
    lastTool = state.activeTool;
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (el.hidden) {
      state.setNumericOp(null);
    } else {
      showOp(state.activeTool && state.activeTool in OPS ? (state.activeTool as TransformToolName) : op);
      syncPivot();
    }
  }

  return { toggle };
}
