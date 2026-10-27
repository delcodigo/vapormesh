import type { Vec3 } from '@/core';
import { latheSelection, type LatheAxis, type LatheSettings, type ModelerState } from '@/modeler';
import { makeDraggable } from './draggable';

export interface LathePanel {
  /** The current options, for the drag tool. Fields that are not numbers come back as NaN, which the tool reports. */
  options(): LatheSettings;
  /** Show where the axis is, after a drag placed it. */
  setCenter(center: Vec3): void;
}

/**
 * The options of the Lathe tool, shown while it is active. Select the profile points, then drag in a view to place the axis
 * and see the shape; or type the axis position and press Lathe.
 */
export function createLathePanel(state: ModelerState, host: HTMLElement): LathePanel {
  const el = document.createElement('div');
  el.className = 'numeric lathe';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Lathe</span></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Spin about</span></div>
      <div class="numeric-row"><select data-f="axis"><option value="y">Y (up / down)</option><option value="x">X (left / right)</option><option value="z">Z (front / back)</option></select></div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Axis passes through</span></div>
      <div class="numeric-row">${['X', 'Y', 'Z'].map((a, i) => `<label>${a}<input data-f="center" data-i="${i}" value="0" inputmode="decimal" spellcheck="false"></label>`).join('')}</div></div>
    <div class="numeric-group"><div class="numeric-heading"><span>Sides</span><span>Angle (deg)</span></div>
      <div class="numeric-row"><input data-f="sides" value="12" inputmode="numeric" spellcheck="false"><input data-f="degrees" value="360" inputmode="decimal" spellcheck="false"></div></div>
    <label class="choice" title="Join the last point back to the first, for rings and tori"><input type="checkbox" data-f="closed"> Close the profile</label>
    <div class="status" data-status></div>
    <div class="hint">1. In Point mode, click the profile points in order along the outline (bottom to top, so faces point outward). 2. Drag in a view to place the axis: the shape follows. Or type where the axis passes and press Lathe.</div>
    <div class="numeric-actions"><button data-act="apply">Lathe</button></div>
    <div class="msg" role="status"></div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const msg = q<HTMLElement>('.msg');
  const number = (input: HTMLInputElement) => {
    const n = input.value.trim() === '' ? NaN : Number(input.value);
    input.classList.toggle('invalid', !Number.isFinite(n));
    return n;
  };
  const center = (): Vec3 => [0, 1, 2].map((i) => number(q<HTMLInputElement>(`[data-f="center"][data-i="${i}"]`))) as Vec3;

  const axis = () => q<HTMLSelectElement>('[data-f="axis"]').value as LatheAxis;
  const closed = () => q<HTMLInputElement>('[data-f="closed"]').checked;
  const options = (): LatheSettings => ({ axis: axis(), center: center(), sides: number(q('[data-f="sides"]')), degrees: number(q('[data-f="degrees"]')), closed: closed() });

  const apply = () => {
    const result = latheSelection(state, options());
    msg.textContent = result.message;
    msg.classList.toggle('error', !result.ok);
  };
  el.addEventListener('input', (e) => (e.target as HTMLElement).classList.remove('invalid'));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') apply();
  });
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act="apply"]')) apply();
  });

  // visible exactly while the Lathe tool is active
  const status = q<HTMLElement>('[data-status]');
  /** What the tool is waiting for right now, so an empty layer or a wrong mode is never a silent nothing. */
  const showStatus = () => {
    const picked = state.mode === 'points' ? state.selectedPoints.size : 0;
    let text: string;
    let ready = false;
    if (state.mesh.points.length === 0) text = 'This layer has no points to spin. Add a shape from the Create tab, or switch layers.';
    else if (state.mode !== 'points') text = 'Switch to Point mode (1) and pick the profile points.';
    else if (picked < 2) text = `Profile: ${picked} point${picked === 1 ? '' : 's'}. Click at least 2 points in order along the outline.`;
    else {
      text = `Profile: ${picked} points. Now drag in a view to place the axis.`;
      ready = true;
    }
    status.textContent = text;
    status.classList.toggle('ready', ready);
  };
  state.subscribe(() => {
    const on = state.activeTool === 'lathe';
    if (on === el.hidden) msg.textContent = '';
    el.hidden = !on;
    if (on) showStatus();
  });

  return {
    options,
    setCenter(c) {
      [0, 1, 2].forEach((i) => {
        const input = q<HTMLInputElement>(`[data-f="center"][data-i="${i}"]`);
        input.value = String(Math.round(c[i]! * 1e5) / 1e5);
        input.classList.remove('invalid');
      });
    },
  };
}
