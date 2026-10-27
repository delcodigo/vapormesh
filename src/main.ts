import './style.css';
import { assignAutoUvs } from '@/core';
import {
  box,
  LAYER_COUNT,
  ModelerState,
  copySelection,
  cutSelection,
  deleteSelection,
  AxisDeformTool,
  ExtrudeTool,
  growSelection,
  hideSelection,
  selectConnected,
  shrinkSelection,
  unhideAll,
  MagnetTool,
  PointDragTool,
  StretchTool,
  KnifeTool,
  flipSelection,
  makePolygon,
  mergeCoincidentPoints,
  MoveTool,
  pasteClipboard,
  triangulateSelection,
  weldSelection,
  type EditResult,
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
  createDeformPanel,
  createExtrudePanel,
  createPositionPanel,
  createBooleanPanel,
  createFileActions,
  createKnifePanel,
  createMirrorPanel,
  createImagesPanel,
  type EditorBridge,
  type DeformPanel,
  type ExtrudePanel,
  type KnifePanel,
  createNumericPanel,
  createPaletteEditor,
  createPrimitivePanel,
  createRenderPanel,
  createSurfacePanel,
  createUvEditor,
} from '@/ui';
import {
  defaultDisplay,
  MeshView,
  ShadedView,
  pickPoint,
  pickPolygon,
  pointsInLasso,
  pointsInRect,
  polygonsInLasso,
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
/** Single-key tool shortcuts. P flips between Point and Polygon mode. Q is selection: no tool, so drags draw a selection box. */
const TOOL_KEYS: Record<string, ToolName | null> = { m: 'move', r: 'rotate', s: 'size', e: 'extrude', k: 'knife', q: null };
const SNAPS: [number, string][] = [
  [0, 'Off'],
  [0.05, '0.05'],
  [0.1, '0.1'],
  [0.25, '0.25'],
  [0.5, '0.5'],
  [1, '1'],
];
const MULTIPLY_TOOLS: [ToolName, string][] = [
  ['extrude', 'Extrude'],
  ['bevel', 'Bevel'],
];
const DEFORM_TOOLS: [ToolName, string][] = [
  ['stretch', 'Stretch'],
  ['drag', 'Drag'],
  ['magnet', 'Magnet'],
  ['bend', 'Bend'],
  ['twist', 'Twist'],
  ['taper', 'Taper'],
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
let knifePanel: KnifePanel | null = null;
let deformPanel: DeformPanel | null = null;
let extrudePanel: ExtrudePanel | null = null; // created once the page exists; the tools ask it for their options
const dragTools: Record<ToolName, DragTool> = {
  move: new MoveTool(state),
  rotate: new RotateTool(state),
  size: new SizeTool(state),
  extrude: new ExtrudeTool(state, () => extrudePanel!.options('extrude'), 'Extrude'),
  bevel: new ExtrudeTool(state, () => extrudePanel!.options('bevel'), 'Bevel'),
  stretch: new StretchTool(state),
  drag: new PointDragTool(state),
  magnet: new MagnetTool(state, () => ({ radius: deformPanel!.magnetRadius() })),
  bend: new AxisDeformTool(state, 'bend', () => deformPanel!.axis(), 'Bend'),
  twist: new AxisDeformTool(state, 'twist', () => deformPanel!.axis(), 'Twist'),
  taper: new AxisDeformTool(state, 'taper', () => deformPanel!.axis(), 'Taper'),
  // the tool reports what it did through the status line, which is declared further down
  knife: new KnifeTool(state, () => knifePanel!.options(), (r) => notify(r.message, !r.ok)),
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
      <button data-action="select" title="Selection: drag to select (Q)">Select</button>
      ${TOOLS.map(([t, label]) => `<button data-tool="${t}" title="${label} (${label === 'Size' ? 'S' : label[0]})">${label}</button>`).join('')}
      <button data-action="numeric">Numeric</button>
      <button data-action="position" title="Show and edit where the selected points are (I)">Position</button>
      <label class="snap" title="Moves and Drag snap to this grid"><span>Snap</span><select data-snap>${SNAPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <div class="section">Deform</div>
      ${DEFORM_TOOLS.map(([t, label]) => `<button data-tool="${t}">${label}</button>`).join('')}
      <div class="section">Multiply</div>
      ${MULTIPLY_TOOLS.map(([t, label]) => `<button data-tool="${t}" title="Drag in a view; select polygons first${t === 'extrude' ? ' (E)' : ''}">${label}</button>`).join('')}
      <button data-action="mirror" title="Reflect polygons across a plane">Mirror</button>
      <div class="section">Tools</div>
      <button data-tool="knife" title="Drag a line across polygons to cut them along it (K)">Knife</button>
      <button data-action="boolean" title="Add, subtract or intersect the solids on two layers">Boolean</button>
      <div class="section">Create</div>
      ${PRIMITIVE_NAMES.map((n) => `<button data-create="${n}">${PRIMITIVES[n].label}</button>`).join('')}
      <div class="section">Surface</div>
      <button data-action="surface">Surfaces</button>
      <button data-action="images">Images</button>
      <button data-action="uv" title="U">UV Editor</button>
      <button data-action="palette">Palette</button>
      <div class="section">Select</div>
      <button data-action="all">All</button>
      <button data-action="invert">Invert</button>
      <button data-action="none">None</button>
      <button data-select="connected" title="Extend the selection to everything joined to it">Connected</button>
      <button data-select="grow" title="Add the points or polygons next to the selection">Grow</button>
      <button data-select="shrink" title="Remove the outer layer of the selection">Shrink</button>
      <button data-action="lasso" title="Drag a freehand outline instead of a box to select">Lasso</button>
      <div class="section">Display</div>
      <button data-select="hide" title="Hide the selected polygons (in Point mode, those whose points are all selected)">Hide</button>
      <button data-select="hideOthers" title="Hide everything except the selection">Hide Others</button>
      <button data-select="unhide" title="Show everything again">Unhide All</button>
      <div class="section">Edit</div>
      <button data-edit="delete" title="Delete the selected points or polygons (Delete)">Delete</button>
      <button data-edit="merge" title="Merge points that sit on top of each other: the selected ones, or all">Merge Points</button>
      <button data-edit="weld" title="Weld the selected points into one, at their average">Weld</button>
      <button data-edit="flip" title="Turn the selected polygons (or all) inside out">Flip</button>
      <button data-edit="make" title="Make a polygon from the selected points, joined in the order you selected them (Shift-click)">Make Polygon</button>
      <button data-edit="triple" title="Split the selected polygons (or all) into triangles">Triple</button>
    </div>
    <div class="viewports">
      ${VIEWS.map(([, n]) => `<div class="viewport"><canvas></canvas><span class="label">${n}</span></div>`).join('')}
    </div>
  </div>
  <div class="bottombar">
    ${MODES.map(([m, label, key]) => `<button data-mode="${m}" title="${label} mode (${key}; P switches)">${label}</button>`).join('')}
    <span class="readout"></span>
    <span class="message" role="status"></span>
    <span class="spacer"></span>
    <button data-action="render" title="Retro render settings">Retro…</button>
    <span class="group" title="How the Perspective view draws">
      ${VIEW_MODES.map(([m, label]) => `<button data-view="${m}">${label}</button>`).join('')}
    </span>
    <span class="spacer"></span>
    <span class="group">
      <button data-edit="cut" title="Cut the selected polygons (Ctrl+X)">Cut</button>
      <button data-edit="copy" title="Copy the selected polygons (Ctrl+C)">Copy</button>
      <button data-edit="paste" title="Paste where they were copied from (Ctrl+V)">Paste</button>
    </span>
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
deformPanel = createDeformPanel(state, app.querySelector('.workspace')!);
extrudePanel = createExtrudePanel(state, app.querySelector('.workspace')!);
knifePanel = createKnifePanel(state, app.querySelector('.workspace')!);
const lassoButton = app.querySelector<HTMLButtonElement>('[data-action="lasso"]')!;
const selectButton = app.querySelector<HTMLButtonElement>('[data-action="select"]')!;
const positionButton = app.querySelector<HTMLButtonElement>('[data-action="position"]')!;
const positionPanel = createPositionPanel(state, app.querySelector('.workspace')!, () => positionButton.classList.toggle('active', positionPanel.isOpen()));
positionButton.classList.add('active');
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
const imagesButton = app.querySelector<HTMLButtonElement>('[data-action="images"]')!;
const uvButton = app.querySelector<HTMLButtonElement>('[data-action="uv"]')!;
const paletteButton = app.querySelector<HTMLButtonElement>('[data-action="palette"]')!;
const mirrorButton = app.querySelector<HTMLButtonElement>('[data-action="mirror"]')!;
const booleanButton = app.querySelector<HTMLButtonElement>('[data-action="boolean"]')!;
const renderButton = app.querySelector<HTMLButtonElement>('[data-action="render"]')!;
const surfaces = createSurfacePanel(state, workspace, () => surfaceButton.classList.toggle('active', surfaces.isOpen()));
const images = createImagesPanel(state, workspace, () => imagesButton.classList.toggle('active', images.isOpen()));
const uvEditor = createUvEditor(state, workspace, () => uvButton.classList.toggle('active', uvEditor.isOpen()));
const paletteEditor = createPaletteEditor(state, workspace, () => paletteButton.classList.toggle('active', paletteEditor.isOpen()));
const mirrorPanel = createMirrorPanel(state, workspace, () => mirrorButton.classList.toggle('active', mirrorPanel.isOpen()));
const booleanPanel = createBooleanPanel(state, workspace, () => booleanButton.classList.toggle('active', booleanPanel.isOpen()));
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

state.subscribe(() => renderSettings.refresh()); // the Retro panel shows the palette, which can change

const EDITS: Record<string, (s: typeof state) => EditResult> = {
  delete: (s) => deleteSelection(s),
  merge: (s) => mergeCoincidentPoints(s),
  weld: weldSelection,
  flip: flipSelection,
  make: makePolygon,
  triple: triangulateSelection,
  cut: cutSelection,
  copy: copySelection,
  paste: pasteClipboard,
};
/** Run an editing command and say what it did, or why it could not. */
const runEdit = (name: string) => {
  const result = EDITS[name]!(state);
  notify(result.message, !result.ok);
};
const pasteButton = app.querySelector<HTMLButtonElement>('[data-edit="paste"]')!;
app.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => runEdit(b.dataset.edit!)));

const ACTIONS: Record<string, () => void> = {
  new: () => files.newProject(),
  load: () => files.load(),
  save: () => files.save(),
  numeric: () => numeric.toggle(),
  position: () => positionPanel.toggle(),
  surface: () => surfaces.toggle(),
  images: () => images.toggle(),
  uv: () => uvEditor.toggle(),
  palette: () => paletteEditor.toggle(),
  mirror: () => mirrorPanel.toggle(),
  boolean: () => booleanPanel.toggle(),
  render: () => renderSettings.toggle(),
  all: () => state.selectAll(),
  invert: () => state.invertSelection(),
  none: () => state.clearSelection(),
  select: () => state.setTool(null),
  lasso: () => state.setLasso(!state.lasso),
};
const SELECT_ACTIONS: Record<string, () => EditResult> = {
  connected: () => selectConnected(state),
  grow: () => growSelection(state),
  shrink: () => shrinkSelection(state),
  hide: () => hideSelection(state),
  hideOthers: () => hideSelection(state, true),
  unhide: () => unhideAll(state),
};
app.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((b) =>
  b.addEventListener('click', () => {
    const r = SELECT_ACTIONS[b.dataset.select!]!();
    notify(r.message, !r.ok);
  }),
);
const snapSelect = app.querySelector<HTMLSelectElement>('[data-snap]')!;
snapSelect.addEventListener('change', () => state.setSnap(Number(snapSelect.value)));
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
  lassoButton.classList.toggle('active', state.lasso);
  selectButton.classList.toggle('active', activeTool === null);
  snapSelect.value = String(state.snap);
  primitiveButtons.forEach((b) => b.classList.toggle('active', b.dataset.create === state.createOp));
  layerButtons.forEach((b, i) => {
    b.classList.toggle('active', i === state.activeLayer);
    b.classList.toggle('filled', state.layers[i]!.points.length > 0);
  });
  pasteButton.disabled = !state.clipboard;
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
  } else if (mod && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    runEdit('copy');
  } else if (mod && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    runEdit('cut');
  } else if (mod && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    runEdit('paste');
  } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    runEdit('delete');
  } else if (e.key === ' ') {
    e.preventDefault();
    state.clearSelection();
  } else if (!mod) {
    const key = e.key.toLowerCase();
    // the transform tools and plain selection, which are used constantly: keys set them rather than toggle, so a
    // press always leaves you in that tool
    if (!e.altKey && Object.hasOwn(TOOL_KEYS, key)) state.setTool(TOOL_KEYS[key]!);
    if (key === 'p') state.setMode(state.mode === 'points' ? 'polygons' : 'points');
    if (key === 'n') numeric.toggle();
    if (key === 'i') positionPanel.toggle();
    if (e.key.toLowerCase() === 'u') uvEditor.toggle();
    for (const [m, , key] of MODES) if (e.key === key) state.setMode(m);
  }
});

/** Shift adds to the selection, Ctrl removes from it, otherwise it replaces. */
function boxSelect(vp: Viewport, i: DragInfo): void {
  const rect = { x0: i.start.x, y0: i.start.y, x1: i.current.x, y1: i.current.y };
  const lasso = state.lasso ? (i.path ?? []) : null;
  const ids = lasso
    ? state.mode === 'points'
      ? pointsInLasso(state.mesh, vp, lasso)
      : polygonsInLasso(state.mesh, vp, lasso)
    : state.mode === 'points'
      ? pointsInRect(state.mesh, vp, rect)
      : polygonsInRect(state.mesh, vp, rect);
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
      return state.activeTool === null || state.activeTool === 'knife';
    },
    get bandShape() {
      return state.activeTool === 'knife' ? ('line' as const) : state.lasso ? ('lasso' as const) : ('box' as const);
    },
    begin: (v, e, press) => {
      const tool = activeDragTool();
      return tool ? !e.shiftKey && tool.begin(v, press) : v.isOrtho;
    },
    move: (i) => activeDragTool()?.move(i),
    end: (i) => {
      const tool = activeDragTool();
      if (tool) tool.end(i);
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
