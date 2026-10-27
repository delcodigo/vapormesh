import './style.css';
import { assignAutoUvs } from '@/core';
import {
  box,
  LAYER_COUNT,
  ModelerState,
  MoveTool,
  PRIMITIVE_NAMES,
  PRIMITIVES,
  RotateTool,
  SizeTool,
  type DragTool,
  type PrimitiveName,
  type SelectMode,
  type ToolName,
} from '@/modeler';
import {
  createFileActions,
  type EditorBridge,
  createNumericPanel,
  createPrimitivePanel,
  createRenderPanel,
  createSurfacePanel,
} from '@/ui';
import {
  defaultDisplay,
  MeshView,
  ShadedView,
  pickPoint,
  pickPolygon,
  pointsInRect,
  polygonsInRect,
  Viewport,
  type DragInfo,
  type ViewMode,
  type ViewKind,
} from '@/render';

// LightWave Modeler's quad layout: Top / Perspective over Face / Left.
const VIEWS: [ViewKind, string][] = [
  ['top', 'Top'],
  ['perspective', 'Perspective'],
  ['face', 'Face'],
  ['left', 'Left'],
];
const MODES: [SelectMode, string, string][] = [
  ['points', 'Point', '1'],
  ['polygons', 'Polygon', '2'],
];
const VIEW_MODES: [ViewMode, string][] = [
  ['wire', 'Wire'],
  ['shaded', 'Shaded'],
  ['shaded-wire', 'Shaded+Wire'],
];
const TOOLS: [ToolName, string][] = [
  ['move', 'Move'],
  ['rotate', 'Rotate'],
  ['size', 'Size'],
];

const demoBox = box(1, 1, 1);
assignAutoUvs(demoBox);
const state = new ModelerState(demoBox);
const display = defaultDisplay();
// ?view=shaded opens straight into a shaded Perspective view
const requested = new URLSearchParams(location.search).get('view');
if (VIEW_MODES.some(([m]) => m === requested)) display.mode = requested as ViewMode;
const dragTools: Record<ToolName, DragTool> = {
  move: new MoveTool(state),
  rotate: new RotateTool(state),
  size: new SizeTool(state),
};
const activeDragTool = () => (state.activeTool ? dragTools[state.activeTool] : null);

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="menubar"><span class="logo">ＶＡＰＯＲＭＥＳＨ</span><span class="jp">ヴェイパーメッシュ</span><span class="menu">Modeler</span><span class="menu">Layout</span><span class="layers">${Array.from({ length: LAYER_COUNT }, (_, i) => `<button class="layer" data-layer="${i}" title="Layer ${i + 1}"></button>`).join('')}</span></div>
  <div class="workspace">
    <div class="toolpanel">
      <div class="section">File</div>
      <button data-action="new">New</button>
      <button data-action="load" title="Ctrl+O">Load</button>
      <button data-action="save" title="Ctrl+S">Save</button>
      <div class="section">Position</div>
      ${TOOLS.map(([t, label]) => `<button data-tool="${t}">${label}</button>`).join('')}
      <button data-action="numeric">Numeric</button>
      <div class="section">Create</div>
      ${PRIMITIVE_NAMES.map((n) => `<button data-create="${n}">${PRIMITIVES[n].label}</button>`).join('')}
      <div class="section">Surface</div>
      <button data-action="surface">Surfaces</button>
      <div class="section">Select</div>
      <button data-action="all">All</button>
      <button data-action="invert">Invert</button>
      <button data-action="none">None</button>
    </div>
    <div class="viewports">
      ${VIEWS.map(([, n]) => `<div class="viewport"><canvas></canvas><span class="label">${n}</span></div>`).join('')}
    </div>
  </div>
  <div class="bottombar">
    ${MODES.map(([m, label]) => `<button data-mode="${m}">${label}</button>`).join('')}
    <span class="readout"></span>
    <span class="message" role="status"></span>
    <span class="spacer"></span>
    <button data-action="render" title="Retro render settings">Retro…</button>
    <span class="group" title="How the Perspective view draws">
      ${VIEW_MODES.map(([m, label]) => `<button data-view="${m}">${label}</button>`).join('')}
    </span>
    <span class="spacer"></span>
    <button id="redo">Redo</button>
    <button id="undo">Undo</button>
  </div>
  <input type="file" id="file-input" accept=".vmesh" hidden>`;

const readout = app.querySelector<HTMLElement>('.readout')!;
const modeButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-mode]')];
const toolButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-tool]')];
const viewButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-view]')];
const showViewMode = () => viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === display.mode));
viewButtons.forEach((b) =>
  b.addEventListener('click', () => {
    display.mode = b.dataset.view as ViewMode;
    showViewMode();
  }),
);
showViewMode();
const undoButton = app.querySelector<HTMLButtonElement>('#undo')!;
const redoButton = app.querySelector<HTMLButtonElement>('#redo')!;

modeButtons.forEach((b) => b.addEventListener('click', () => state.setMode(b.dataset.mode as SelectMode)));
toolButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const tool = b.dataset.tool as ToolName;
    state.setTool(state.activeTool === tool ? null : tool);
  }),
);
const numeric = createNumericPanel(state, app.querySelector('.workspace')!);
const numericButton = app.querySelector<HTMLButtonElement>('[data-action="numeric"]')!;
const primitives = createPrimitivePanel(state, app.querySelector('.workspace')!);
const primitiveButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-create]')];
primitiveButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const name = b.dataset.create as PrimitiveName;
    if (state.createOp === name) primitives.close();
    else primitives.open(name);
  }),
);
const layerButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-layer]')];
layerButtons.forEach((b, i) => b.addEventListener('click', () => state.setActiveLayer(i)));

const workspace = app.querySelector<HTMLElement>('.workspace')!;
const surfaceButton = app.querySelector<HTMLButtonElement>('[data-action="surface"]')!;
const renderButton = app.querySelector<HTMLButtonElement>('[data-action="render"]')!;
const surfaces = createSurfacePanel(state, workspace, () => surfaceButton.classList.toggle('active', surfaces.isOpen()));
const renderSettings = createRenderPanel(display.retro, workspace, () => state.palette, () => renderButton.classList.toggle('active', renderSettings.isOpen()));

const message = app.querySelector<HTMLElement>('.message')!;
let messageTimer = 0;
const notify = (text: string, isError = false) => {
  message.textContent = text;
  message.classList.toggle('error', isError);
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (message.textContent = ''), isError ? 8000 : 3500);
};
const editorBridge: EditorBridge = {
  capture: () => ({
    selectMode: state.mode,
    customPivot: state.customPivot,
    views: Object.fromEntries(viewports.map(({ vp }) => [vp.kind, vp.getView()])),
  }),
  apply: (e) => {
    state.setMode(e.selectMode);
    state.setPivot(e.customPivot);
    for (const { vp } of viewports) {
      const view = e.views[vp.kind];
      if (view) vp.setView(view);
    }
  },
  reset: () => {
    state.setPivot(null);
    for (const { vp } of viewports) vp.resetView();
  },
};
const files = createFileActions(state, display, app.querySelector<HTMLInputElement>('#file-input')!, editorBridge, notify, showViewMode);
window.addEventListener('beforeunload', (e) => {
  if (files.isDirty()) e.preventDefault(); // makes the browser ask before closing with unsaved work
});

const ACTIONS: Record<string, () => void> = {
  new: () => files.newProject(),
  load: () => files.load(),
  save: () => files.save(),
  numeric: () => numeric.toggle(),
  surface: () => surfaces.toggle(),
  render: () => renderSettings.toggle(),
  all: () => state.selectAll(),
  invert: () => state.invertSelection(),
  none: () => state.clearSelection(),
};
app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) =>
  b.addEventListener('click', () => ACTIONS[b.dataset.action!]!()),
);
undoButton.addEventListener('click', () => state.undo());
redoButton.addEventListener('click', () => state.redo());

state.subscribe(() => {
  const { mesh, mode, selection, activeTool, history } = state;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === activeTool));
  numericButton.classList.toggle('active', state.numericOp !== null);
  primitiveButtons.forEach((b) => b.classList.toggle('active', b.dataset.create === state.createOp));
  layerButtons.forEach((b, i) => {
    b.classList.toggle('active', i === state.activeLayer);
    b.classList.toggle('filled', state.layers[i]!.points.length > 0);
  });
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
  undoButton.title = history.undoLabel ?? '';
  redoButton.title = history.redoLabel ?? '';
  const total = mode === 'points' ? mesh.points.length : mesh.polygons.length;
  readout.textContent = `${selection.size} / ${total}`;
});

window.addEventListener('keydown', (e) => {
  // Typing in a numeric field must not trigger shortcuts (1/2 switch modes, space clears, Ctrl+Z undoes).
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    files.save();
  } else if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    files.load();
  } else if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) state.redo();
    else state.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    state.redo();
  } else if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    state.selectAll();
  } else if (mod && e.key.toLowerCase() === 'i') {
    e.preventDefault();
    state.invertSelection();
  } else if (e.key === ' ') {
    e.preventDefault();
    state.clearSelection();
  } else if (!mod) {
    if (e.key.toLowerCase() === 'n') numeric.toggle();
    for (const [m, , key] of MODES) if (e.key === key) state.setMode(m);
  }
});

/** Shift adds to the selection, Ctrl removes from it, otherwise it replaces. */
function boxSelect(vp: Viewport, i: DragInfo): void {
  const rect = { x0: i.start.x, y0: i.start.y, x1: i.current.x, y1: i.current.y };
  const ids =
    state.mode === 'points' ? pointsInRect(state.mesh, vp, rect) : polygonsInRect(state.mesh, vp, rect);
  state.applySelection(ids, i.ctrl ? 'remove' : i.shift ? 'add' : 'replace');
}

const viewports = [...document.querySelectorAll<HTMLCanvasElement>('.viewport canvas')].map((c, i) => {
  const vp = new Viewport(c, VIEWS[i]![0]);
  const view = new MeshView(state);
  vp.scene.add(view.group);
  const shaded = vp.kind === 'perspective' ? new ShadedView(state) : null;
  if (shaded) {
    vp.shadedScene.add(shaded.group);
    vp.display = display;
  }
  vp.onClick = (x, y, e) => {
    const id =
      state.mode === 'points' ? pickPoint(state.mesh, vp, x, y) : pickPolygon(state.mesh, vp, x, y);
    state.applyPick(id, e.shiftKey ? 'toggle' : 'replace');
  };
  vp.dragHandler = {
    // With no tool active, ortho drags draw a selection box.
    get rubberBand() {
      return state.activeTool === null;
    },
    begin: (v, e) => {
      const tool = activeDragTool();
      return tool ? !e.shiftKey && tool.begin(v) : v.isOrtho;
    },
    move: (i) => activeDragTool()?.move(i),
    end: (i) => {
      const tool = activeDragTool();
      if (tool) tool.end();
      else boxSelect(vp, i);
    },
    cancel: () => activeDragTool()?.cancel(),
  };
  return { vp, view, shaded };
});

state.changed();

function frame() {
  for (const { vp, view, shaded } of viewports) {
    view.update();
    vp.palette = state.palette;
    if (shaded && display.mode !== 'wire') shaded.update();
    vp.resize();
    vp.render();
  }
  requestAnimationFrame(frame);
}
frame();
