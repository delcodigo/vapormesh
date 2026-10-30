import type { IndexedImage, Palette, ProjectionAxis, UV } from '@/core';
import {
  applyProjection,
  cornersInRect,
  pickCorner,
  uvCorners,
  UvDrag,
  weldGroup,
  weldIndex,
  type ModelerState,
  type UvCorner,
  type UvToolKind,
} from '@/modeler';
import { THEME } from '@/theme';
import { makeDraggable } from './draggable';
import { paintImage } from './imagesPanel';

const SIZE = 400; // canvas pixels
const MAX_SHOWN = 4000; // polygons drawn at once
const PICK_RADIUS = 8;
const CLICK_SLOP = 4;
const DEFAULT_TEXTURE = 64;

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const PROJECTIONS = [
  ['box', 'Box (fixed density)'],
  ['planar', 'Planar'],
  ['cylindrical', 'Cylindrical'],
  ['spherical', 'Spherical'],
] as const;

export interface UvEditor {
  toggle(): void;
  isOpen(): boolean;
  /** Whether an event target is inside the editor, so its keys are the ones to act on. */
  contains(target: EventTarget | null): boolean;
  /** Handle a tool or selection key (Q M R S, Space, Ctrl+A, Escape); false if it is not one of those. */
  handleKey(e: KeyboardEvent): boolean;
}

type Tool = 'select' | UvToolKind;

/**
 * A 2D editor for the UVs of the polygons selected in the 3D views (or of the whole layer if none are): the texture
 * behind, the polygons' UVs on top. Left-drag selects with the Select tool, or drags with Move / Rotate / Size;
 * right or middle drag pans; the wheel zooms. Like the 3D views, Move / Rotate / Size act on the selected corners, and
 * with none selected a drag selects instead. Q M R S pick the tool while the editor has the focus.
 */
export function createUvEditor(state: ModelerState, host: HTMLElement, onToggle: () => void): UvEditor {
  const el = document.createElement('div');
  el.className = 'numeric uv';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>UV Editor</span><button data-act="close" title="Close">×</button></div>
    <div class="uv-row">
      <div class="numeric-tabs uv-tools">
        <button data-tool="select" title="Drag a box to select corners (Q)">Select</button>
        <button data-tool="move" title="Drag to move the selected corners (M)">Move</button>
        <button data-tool="rotate" title="Drag around the centre to rotate (R)">Rotate</button>
        <button data-tool="size" title="Drag away from or towards the centre to scale (S)">Size</button>
      </div>
    </div>
    <div class="uv-row">
      <select data-f="image" title="The image shown behind the UVs"></select>
      <label class="choice" title="Snap to texels (move, size) or 15 degrees (rotate)"><input type="checkbox" data-f="snap" checked> Snap</label>
      <button data-act="fit" title="Show the whole 0..1 square">Fit</button>
    </div>
    <canvas class="uv-canvas" width="${SIZE}" height="${SIZE}" tabindex="0"></canvas>
    <div class="uv-status"></div>
    <div class="msg" role="status"></div>
    <div class="numeric-heading"><span>Project</span></div>
    <div class="uv-row">
      <select data-f="projection">${PROJECTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select data-f="axis" title="The axis to project along (or wrap around)"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select>
      <button data-act="project" title="Generate UVs for the selected polygons, or the whole layer if none are selected">Apply</button>
    </div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>('canvas.uv-canvas');
  const ctx = canvas.getContext('2d')!;
  const imageSel = q<HTMLSelectElement>('[data-f="image"]');
  const snapBox = q<HTMLInputElement>('[data-f="snap"]');
  const projSel = q<HTMLSelectElement>('[data-f="projection"]');
  const axisSel = q<HTMLSelectElement>('[data-f="axis"]');
  const status = q<HTMLElement>('.uv-status');
  const msg = q<HTMLElement>('.msg');
  const toolButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-tool]')];

  // --- view: UV space to canvas pixels (u right, v down, like the image) ---
  let scale = 340;
  let ox = 30;
  let oy = 30;
  const toScreen = (u: number, v: number): [number, number] => [ox + u * scale, oy + v * scale];
  const toUv = (x: number, y: number): UV => [(x - ox) / scale, (y - oy) / scale];
  const fitView = () => {
    scale = SIZE * 0.86;
    ox = oy = (SIZE - scale) / 2;
  };
  fitView();

  // --- what is shown ---
  let polygons: number[] = [];
  let corners: UvCorner[] = [];
  let welds = new Map<number, UvCorner[]>(); // the corners by point, for fast weld groups
  let tooMany = 0;
  const selected = new Set<number>();
  let imageName = '';
  let followed = -2;
  let imageKey = '';
  let tool: Tool = 'select';
  let drag: UvDrag | null = null;
  let band: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let cursor: UV | null = null;
  let texture: { image: IndexedImage; palette: Palette; canvas: HTMLCanvasElement } | null = null;

  const currentImage = () => state.images.find((i) => i.name === imageName);

  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  /** The image behind the UVs, painted once through the palette and reused until the image or palette changes. */
  const textureCanvas = (image: IndexedImage) => {
    if (!texture || texture.image !== image || texture.palette !== state.palette) {
      const canvas = document.createElement('canvas');
      paintImage(canvas, image, state.palette);
      texture = { image, palette: state.palette, canvas };
    }
    return texture.canvas;
  };

  // --- drawing ---
  let drawQueued = false;
  const draw = () => {
    drawQueued = false;
    ctx.fillStyle = '#1b0f3b';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;

    const image = currentImage();
    if (image) ctx.drawImage(textureCanvas(image), ox, oy, scale, scale);
    else {
      ctx.fillStyle = '#2b1a58';
      ctx.fillRect(ox, oy, scale, scale);
    }
    if (image && scale / image.width >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= image.width; i++) {
        const x = Math.round(ox + (i * scale) / image.width) + 0.5;
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + scale);
      }
      for (let i = 0; i <= image.height; i++) {
        const y = Math.round(oy + (i * scale) / image.height) + 0.5;
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + scale, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = css(THEME.gridMajor);
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, scale, scale);

    ctx.lineWidth = 1;
    ctx.strokeStyle = css(THEME.wire);
    ctx.fillStyle = 'rgba(255,113,206,0.14)';
    for (const id of polygons) {
      const uvs = state.mesh.polygons[id]?.uvs;
      if (!uvs) continue;
      ctx.beginPath();
      uvs.forEach(([u, v], i) => {
        const [x, y] = toScreen(u, v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const c of corners) {
      const [x, y] = toScreen(c.u, c.v);
      const on = selected.has(c.key);
      const s = on ? 7 : 4;
      ctx.fillStyle = on ? css(THEME.selected) : css(THEME.point);
      ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    }
    if (band) {
      ctx.strokeStyle = css(THEME.selected);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(band.x0 + 0.5, band.y0 + 0.5, band.x1 - band.x0, band.y1 - band.y0);
      ctx.setLineDash([]);
    }
  };
  const redraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(draw);
  };

  const updateStatus = () => {
    const image = currentImage();
    const [w, h] = [image?.width ?? DEFAULT_TEXTURE, image?.height ?? DEFAULT_TEXTURE];
    const where = cursor ? `texel ${Math.floor(cursor[0] * w)}, ${Math.floor(cursor[1] * h)} · ` : '';
    status.textContent = `${where}${corners.length} corners, ${selected.size} selected`;
  };

  // --- keeping up with the model ---
  const refresh = () => {
    const picked = state.selectedPolygonIds();
    const ids = picked.length ? picked : state.mesh.polygons.map((_, i) => i);
    tooMany = ids.length > MAX_SHOWN ? ids.length : 0;
    polygons = tooMany ? [] : ids;
    corners = uvCorners(state.mesh, polygons);
    welds = weldIndex(corners);
    const alive = new Set(corners.map((c) => c.key));
    for (const key of selected) if (!alive.has(key)) selected.delete(key);

    // list the project's images, only touching the dropdown when they changed
    const key = state.images.map((i) => i.name).join('\n');
    if (key !== imageKey) {
      imageKey = key;
      imageSel.replaceChildren(new Option('(none)', ''), ...state.images.map((i) => new Option(i.name, i.name)));
    }
    // show the texture of the first polygon shown, whenever that changes
    const first = polygons[0] ?? -1;
    if (first !== followed) {
      followed = first;
      imageName = first >= 0 ? (state.mesh.surfaces[state.mesh.polygons[first]!.surface]?.texture ?? '') : '';
    }
    if (!state.images.some((i) => i.name === imageName)) imageName = '';
    imageSel.value = imageName;

    if (tooMany) say(`Too many polygons to show (${tooMany}). Select fewer.`, true);
    else if (polygons.length === 0) say('No polygons yet.');
    else if (corners.length === 0) say('These polygons have no UVs yet. Pick a projection below and press Apply.');
    else say('');
    updateStatus();
    redraw();
  };

  // --- tools and selection ---
  const setTool = (next: Tool) => {
    tool = next;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  };
  setTool('select');

  const apply = (keys: number[], how: 'replace' | 'add' | 'remove' | 'toggle') => {
    if (how === 'replace') selected.clear();
    if (how === 'toggle') {
      const all = keys.every((k) => selected.has(k));
      for (const k of keys) (all ? selected.delete(k) : selected.add(k));
    } else {
      for (const k of keys) (how === 'remove' ? selected.delete(k) : selected.add(k));
    }
    updateStatus();
    redraw();
  };
  /** A click or box picks every corner welded to the ones hit, so seams stay together. */
  const withWelds = (hit: UvCorner[]) => [...new Set(hit.flatMap((c) => weldGroup(corners, c, welds)))];

  // --- pointer ---
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.getBoundingClientRect();
    return [((e.clientX - box.left) * SIZE) / box.width, ((e.clientY - box.top) * SIZE) / box.height];
  };
  type Pointer = { button: number; x0: number; y0: number; lastX: number; lastY: number; start: UV; moved: boolean; mode: 'none' | 'tool' | 'band' | 'pan' };
  let pointer: Pointer | null = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    pointer = { button: e.button, x0: x, y0: y, lastX: x, lastY: y, start: toUv(x, y), moved: false, mode: 'none' };
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    cursor = toUv(x, y);
    if (!pointer) {
      updateStatus();
      return;
    }
    if (!pointer.moved) {
      if (Math.hypot(x - pointer.x0, y - pointer.y0) < CLICK_SLOP) return;
      pointer.moved = true;
      if (pointer.button !== 0) pointer.mode = 'pan';
      else if (tool === 'select' || selected.size === 0) pointer.mode = 'band'; // nothing to transform: select instead
      else {
        const image = currentImage();
        const affected = corners.filter((c) => selected.has(c.key));
        drag = new UvDrag(state, tool);
        const began = drag.begin(affected, {
          snap: snapBox.checked,
          texWidth: image?.width ?? DEFAULT_TEXTURE,
          texHeight: image?.height ?? DEFAULT_TEXTURE,
          minRadius: 16 / scale,
        });
        if (began) pointer.mode = 'tool';
        else drag = null;
      }
    }
    if (pointer.mode === 'pan') {
      ox += x - pointer.lastX;
      oy += y - pointer.lastY;
      redraw();
    } else if (pointer.mode === 'band') {
      band = { x0: pointer.x0, y0: pointer.y0, x1: x, y1: y };
      redraw();
    } else if (pointer.mode === 'tool') {
      drag!.move(pointer.start, toUv(x, y));
    }
    pointer.lastX = x;
    pointer.lastY = y;
    updateStatus();
  });
  const finish = (e: PointerEvent, commit: boolean) => {
    const p = pointer;
    pointer = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!p) return;
    const [x, y] = local(e);
    if (p.mode === 'tool') {
      if (commit) drag!.end();
      else drag!.cancel();
      drag = null;
    } else if (p.mode === 'band') {
      const rect = band!;
      band = null;
      if (commit) {
        const how = e.ctrlKey || e.metaKey ? 'remove' : e.shiftKey ? 'add' : 'replace';
        apply(withWelds(cornersInRect(corners, toScreen, rect)), how);
      }
      redraw();
    } else if (!p.moved && p.button === 0 && commit) {
      const hit = pickCorner(corners, toScreen, x, y, PICK_RADIUS);
      if (hit) apply(withWelds([hit]), e.shiftKey ? 'toggle' : 'replace');
      else if (!e.shiftKey) apply([], 'replace');
    }
  };
  canvas.addEventListener('pointerup', (e) => finish(e, true));
  canvas.addEventListener('pointercancel', (e) => finish(e, false));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      const [u, v] = toUv(x, y);
      scale = Math.min(Math.max(scale * Math.exp(-e.deltaY * 0.0015), 24), 40000);
      ox = x - u * scale; // keep the point under the cursor where it is
      oy = y - v * scale;
      redraw();
    },
    { passive: false },
  );
  const TOOL_KEYS: Record<string, Tool> = { q: 'select', m: 'move', r: 'rotate', s: 'size' };
  const handleKey = (e: KeyboardEvent): boolean => {
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (!mod && !e.altKey && Object.hasOwn(TOOL_KEYS, key)) setTool(TOOL_KEYS[key]!);
    else if (mod && key === 'a') apply(corners.map((c) => c.key), 'replace');
    else if (!mod && (key === ' ' || key === 'escape')) apply([], 'replace');
    else return false;
    e.preventDefault();
    return true;
  };

  // --- controls ---
  imageSel.addEventListener('change', () => {
    imageName = imageSel.value;
    imageSel.blur(); // keep the tool keys working
    updateStatus();
    redraw();
  });
  snapBox.addEventListener('change', () => snapBox.blur());
  projSel.addEventListener('change', () => (axisSel.disabled = projSel.value === 'box'));
  axisSel.disabled = projSel.value === 'box';

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const toolName = target.closest<HTMLElement>('[data-tool]')?.dataset.tool as Tool | undefined;
    if (toolName) return setTool(toolName);
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') toggle();
    else if (act === 'fit') {
      fitView();
      redraw();
    } else if (act === 'project') {
      const kind = projSel.value as 'box' | 'planar' | 'cylindrical' | 'spherical';
      const projection = kind === 'box' ? ({ kind } as const) : ({ kind, axis: axisSel.value as ProjectionAxis } as const);
      const changed = applyProjection(state, projection);
      say(changed ? `Applied ${kind} projection` : 'Nothing changed');
    }
  });

  state.subscribe(() => {
    if (!el.hidden) refresh();
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) {
      followed = -2;
      fitView();
      refresh();
    }
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden, contains: (target) => target instanceof Node && el.contains(target), handleKey };
}
