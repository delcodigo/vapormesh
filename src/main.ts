import './style.css';
import { assignAutoUvs, Mesh } from '@/core';
import mascotUrl from '../mascot.vmesh?url';
import {
  box,
  LAYER_COUNT,
  ModelerState,
  copySelection,
  cutSelection,
  deleteSelection,
  AxisDeformTool,
  ExtrudeTool,
  LatheTool,
  growSelection,
  hideSelection,
  showAllLayers,
  soloLayer,
  toggleHidden,
  toggleLayerHidden,
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
  createArrayPanel,
  createExtrudePanel,
  createLathePanel,
  createMtlPrompt,
  setupMenus,
  createPositionPanel,
  createStatsPanel,
  createBooleanPanel,
  createFileActions,
  createKnifePanel,
  createMirrorPanel,
  createImagesPanel,
  type EditorBridge,
  type DeformPanel,
  type ExtrudePanel,
  type LathePanel,
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
  boundsOf,
  pointsInLasso,
  pointsInRect,
  polygonsInLasso,
  polygonsInRect,
  Viewport,
  VIEW_SIDES,
  type DragInfo,
  type ViewSide,
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
type TabName = 'create' | 'modify' | 'multiply' | 'select' | 'show' | 'edit' | 'surface';
const TABS: [TabName, string][] = [
  ['create', 'Create'],
  ['modify', 'Modify'],
  ['multiply', 'Multiply'],
  ['select', 'Pick'],
  ['show', 'Show'],
  ['edit', 'Edit'],
  ['surface', 'Surface'],
];
/** The tab a drag tool lives on, so choosing it with a key shows its neighbours. Move, Rotate and Size are always visible. */
const TOOL_TAB: Partial<Record<ToolName, TabName>> = {
  stretch: 'modify', drag: 'modify', magnet: 'modify', bend: 'modify', twist: 'modify', taper: 'modify',
  extrude: 'multiply', bevel: 'multiply', lathe: 'multiply', knife: 'multiply',
};
const SNAPS: [number, string][] = [
  [0, 'Off'],
  [0.005, '0.005'],
  [0.01, '0.01'],
  [0.025, '0.025'],
  [0.05, '0.05'],
  [0.1, '0.1'],
  [0.25, '0.25'],
  [0.5, '0.5'],
  [1, '1'],
];
const MULTIPLY_TOOLS: [ToolName, string][] = [
  ['extrude', 'Extrude'],
  ['bevel', 'Bevel'],
  ['lathe', 'Lathe'],
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
// The editor opens on the mascot (mascot.vmesh); `?blank` opens on the plain box instead, which is handy for testing.
const startBlank = new URLSearchParams(location.search).has('blank');
const state = new ModelerState(startBlank ? demoBox : new Mesh());
const display = defaultDisplay();
// ?view=shaded opens straight into a shaded Perspective view
const requested = new URLSearchParams(location.search).get('view');
if (VIEW_MODES.some(([m]) => m === requested)) display.mode = requested as ViewMode;
let knifePanel: KnifePanel | null = null;
let deformPanel: DeformPanel | null = null;
let lathePanel: LathePanel | null = null;
let extrudePanel: ExtrudePanel | null = null; // created once the page exists; the tools ask it for their options
const dragTools: Record<ToolName, DragTool> = {
  move: new MoveTool(state),
  rotate: new RotateTool(state),
  size: new SizeTool(state),
  extrude: new ExtrudeTool(state, () => extrudePanel!.options('extrude'), 'Extrude'),
  bevel: new ExtrudeTool(state, () => extrudePanel!.options('bevel'), 'Bevel'),
  lathe: new LatheTool(state, () => lathePanel!.options(), (c) => lathePanel!.setCenter(c), (r) => notify(r.message, !r.ok)),
  stretch: new StretchTool(state),
  drag: new PointDragTool(state),
  magnet: new MagnetTool(state, () => ({ radius: deformPanel!.magnetRadius() })),
  bend: new AxisDeformTool(state, 'bend', () => deformPanel!.axis(), 'Bend'),
  twist: new AxisDeformTool(state, 'twist', () => deformPanel!.axis(), 'Twist'),
  taper: new AxisDeformTool(state, 'taper', () => deformPanel!.axis(), 'Taper'),
  // the tool reports what it did through the status line, which is declared further down
  knife: new KnifeTool(state, () => knifePanel!.options(), (r) => notify(r.message, !r.ok)),
};
/** Move, Rotate and Size act on the selection; with nothing selected their drags select instead of transforming the whole object. */
const SELECTION_TOOLS = ['move', 'rotate', 'size'];
let selectingInstead = false;
const activeDragTool = () => (state.activeTool && !selectingInstead ? dragTools[state.activeTool] : null);

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="menubar"><span class="logo">ＶＡＰＯＲＭＥＳＨ</span><span class="jp">ヴェイパーメッシュ</span><span class="menuwrap">
      <button class="menutitle" data-menu="file" aria-haspopup="menu" aria-expanded="false">File</button>
      <div class="dropdown" role="menu" hidden>
        <button role="menuitem" data-action="new"><span>New</span></button>
        <button role="menuitem" data-action="load"><span>Load…</span><kbd>Ctrl+O</kbd></button>
        <button role="menuitem" data-action="save"><span>Save…</span><kbd>Ctrl+S</kbd></button>
        <div class="sep" role="separator"></div>
        <button role="menuitem" data-action="importObj" title="Add an .obj to empty layers. Select its .mtl as well (Ctrl-click) for colours, or you will be asked for it"><span>Import OBJ…</span></button>
        <button role="menuitem" data-action="exportObj" title="Download the model as .obj and .mtl"><span>Export OBJ…</span></button>
      </div>
    </span><span class="menu">Modeler</span><span class="menu">Layout</span><span class="layers">${Array.from({ length: LAYER_COUNT }, (_, i) => `<button class="layer" data-layer="${i}" title="Layer ${i + 1}"></button>`).join('')}</span></div>
  <div class="workspace">
    <div class="toolpanel">
      <div class="quick">
        <button data-action="select" title="Selection: drag to select (Q)">Select</button>
        ${TOOLS.map(([t, label]) => `<button data-tool="${t}" title="${label} (${label === 'Size' ? 'S' : label[0]})">${label}</button>`).join('')}
        <span class="axes" title="Limit Move, Rotate and Size to an axis (X, Y, Z keys). Rotate turns about a single locked axis">${(['X', 'Y', 'Z'] as const).map((a, i) => `<button data-axis="${i}" title="Only along ${a} (${a})">${a}</button>`).join('')}</span>
        <label class="snap" title="Moves, Drag, Magnet, Extrude and Size snap to this grid"><span>Snap</span><select data-snap>${SNAPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      </div>
      <div class="tabs">${TABS.map(([t, label]) => `<button data-tab="${t}">${label}</button>`).join('')}</div>
      <div class="tabpage" data-page="create">
        ${PRIMITIVE_NAMES.map((n) => `<button data-create="${n}">${PRIMITIVES[n].label}</button>`).join('')}
      </div>
      <div class="tabpage" data-page="modify">
        <button data-action="numeric" title="Type exact Move, Rotate and Size values (N)">Numeric</button>
        <button data-action="position" title="Show and edit where the selected points are (I)">Position</button>
        <button data-action="stats" title="Show the size of the selection, or of the layer, and type a new size (J)">Stats</button>
        <div class="section">Deform</div>
        ${DEFORM_TOOLS.map(([t, label]) => `<button data-tool="${t}">${label}</button>`).join('')}
      </div>
      <div class="tabpage" data-page="multiply">
        ${MULTIPLY_TOOLS.map(([t, label]) => `<button data-tool="${t}" title="${t === 'lathe' ? 'Select the profile points in order, then drag in a view to place the axis' : `Drag in a view; select polygons first${t === 'extrude' ? ' (E)' : ''}`}">${label}</button>`).join('')}
        <button data-action="array" title="Copy polygons several times, stepping each copy">Array</button>
        <button data-action="mirror" title="Reflect polygons across a plane">Mirror</button>
        <button data-tool="knife" title="Drag a line across polygons to cut them along it; hold Shift for a horizontal or vertical slice (K)">Knife</button>
        <button data-action="boolean" title="Add, subtract or intersect the solids on two layers">Boolean</button>
      </div>
      <div class="tabpage" data-page="select">
        <button data-action="all">All</button>
        <button data-action="invert">Invert</button>
        <button data-action="none">None</button>
        <button data-select="connected" title="Extend the selection to everything joined to it">Connected</button>
        <button data-select="grow" title="Add the points or polygons next to the selection">Grow</button>
        <button data-select="shrink" title="Remove the outer layer of the selection">Shrink</button>
        <button data-action="lasso" title="Drag a freehand outline instead of a box to select">Lasso</button>
      </div>
      <div class="tabpage" data-page="show">
        <div class="section">Polygons</div>
        <button data-select="hide" title="Hide the selected polygons; in Point mode, those whose points are all selected (H)">Hide</button>
        <button data-select="hideOthers" title="Hide everything except the selection (Shift+H)">Hide Others</button>
        <button data-select="unhide" title="Show every hidden polygon again (H with nothing selected)">Unhide All</button>
        <div class="section">Layers</div>
        <button data-select="solo" title="Hide every other layer, to look at this one alone">Solo Layer</button>
        <button data-select="showLayers" title="Show every hidden layer again">Show Layers</button>
        <div class="hint">Shift-click a layer square (top right) to hide or show that layer.</div>
      </div>
      <div class="tabpage" data-page="edit">
        <button data-edit="delete" title="Delete the selected points or polygons (Delete)">Delete</button>
        <button data-edit="merge" title="Merge points that sit on top of each other: the selected ones, or all">Merge Points</button>
        <button data-edit="weld" title="Weld the selected points into one, at their average">Weld</button>
        <button data-edit="flip" title="Turn the selected polygons (or all) inside out">Flip</button>
        <button data-edit="make" title="Make a polygon from the selected points, joined in the order you selected them (Shift-click) (F)">Make Polygon</button>
        <button data-edit="triple" title="Split the selected polygons (or all) into triangles">Triple</button>
      </div>
      <div class="tabpage" data-page="surface">
        <button data-action="surface">Surfaces</button>
        <button data-action="images">Images</button>
        <button data-action="uv" title="U">UV Editor</button>
        <button data-action="palette">Palette</button>
      </div>
    </div>
    <div class="viewports">
      ${VIEWS.map(([k, n]) => `<div class="viewport"><canvas></canvas>${k === 'perspective' ? `<span class="label">${n}</span>` : `<select class="label side" title="Which side this view looks from">${VIEW_SIDES.map(([v, l]) => `<option value="${v}"${v === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`}</div>`).join('')}
    </div>
  </div>
  <div class="bottombar">
    ${MODES.map(([m, label, key]) => `<button data-mode="${m}" title="${label} mode (${key}; P switches)">${label}</button>`).join('')}
    <span class="readout"></span>
    <span class="message" role="status"></span>
    <span class="spacer"></span>
    <button data-action="fit" title="Centre the model in every view and zoom to show all of it (A)">Fit</button>
    <button data-action="facing" title="Hide the lines and points the model covers, so the far side does not clutter the wireframe">Hide hidden</button>
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
  <input type="file" id="file-input" accept=".vmesh" hidden>
  <input type="file" id="obj-input" accept=".obj,.mtl" multiple hidden>
  <input type="file" id="mtl-input" accept=".mtl" hidden>`;

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
const tabButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-tab]')];
const tabPages = [...app.querySelectorAll<HTMLElement>('[data-page]')];
const showTab = (tab: TabName) => {
  tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  tabPages.forEach((p) => (p.hidden = p.dataset.page !== tab));
  try {
    localStorage.setItem('vapormesh.tab', tab);
  } catch {
    /* private window or blocked storage: the tab just isn't remembered */
  }
};
let remembered: string | null = null;
try {
  remembered = localStorage.getItem('vapormesh.tab');
} catch {
  /* as above */
}
showTab(TABS.find(([t]) => t === remembered)?.[0] ?? 'create');
tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as TabName)));
let lastTool = state.activeTool;
state.subscribe(() => {
  if (state.activeTool !== lastTool) {
    lastTool = state.activeTool;
    const tab = lastTool && TOOL_TAB[lastTool];
    if (tab) showTab(tab);
  }
});
const undoButton = app.querySelector<HTMLButtonElement>('#undo')!;
const redoButton = app.querySelector<HTMLButtonElement>('#redo')!;

modeButtons.forEach((b) => b.addEventListener('click', () => state.setMode(b.dataset.mode as SelectMode)));
toolButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const tool = b.dataset.tool as ToolName;
    state.setTool(state.activeTool === tool ? null : tool);
  }),
);
setupMenus(app.querySelector<HTMLElement>('.menubar')!);
const numeric = createNumericPanel(state, app.querySelector('.workspace')!);
deformPanel = createDeformPanel(state, app.querySelector('.workspace')!);
lathePanel = createLathePanel(state, app.querySelector('.workspace')!);
extrudePanel = createExtrudePanel(state, app.querySelector('.workspace')!);
knifePanel = createKnifePanel(state, app.querySelector('.workspace')!);
let hideHidden = false;
try {
  hideHidden = localStorage.getItem('vapormesh.hideHidden') === 'true';
} catch {}
const facingButton = app.querySelector<HTMLButtonElement>('[data-action="facing"]')!;
facingButton.classList.toggle('active', hideHidden);
const axisButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-axis]')];
axisButtons.forEach((b) => b.addEventListener('click', () => state.toggleAxis(Number(b.dataset.axis) as 0 | 1 | 2)));
const lassoButton = app.querySelector<HTMLButtonElement>('[data-action="lasso"]')!;
const selectButton = app.querySelector<HTMLButtonElement>('[data-action="select"]')!;
const positionButton = app.querySelector<HTMLButtonElement>('[data-action="position"]')!;
const positionPanel = createPositionPanel(state, app.querySelector('.workspace')!, () => positionButton.classList.toggle('active', positionPanel.isOpen()));
positionButton.classList.add('active');
const statsButton = app.querySelector<HTMLButtonElement>('[data-action="stats"]')!;
const statsPanel = createStatsPanel(state, app.querySelector('.workspace')!, () => statsButton.classList.toggle('active', statsPanel.isOpen()));
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
layerButtons.forEach((b, i) =>
  b.addEventListener('click', (e) => {
    // Shift-click hides or shows a layer; a plain click goes to it (which also shows it)
    if (!e.shiftKey) return state.setActiveLayer(i);
    const r = toggleLayerHidden(state, i);
    notify(r.message, !r.ok);
  }),
);

const workspace = app.querySelector<HTMLElement>('.workspace')!;
const surfaceButton = app.querySelector<HTMLButtonElement>('[data-action="surface"]')!;
const imagesButton = app.querySelector<HTMLButtonElement>('[data-action="images"]')!;
const uvButton = app.querySelector<HTMLButtonElement>('[data-action="uv"]')!;
const paletteButton = app.querySelector<HTMLButtonElement>('[data-action="palette"]')!;
const arrayButton = app.querySelector<HTMLButtonElement>('[data-action="array"]')!;
const mirrorButton = app.querySelector<HTMLButtonElement>('[data-action="mirror"]')!;
const booleanButton = app.querySelector<HTMLButtonElement>('[data-action="boolean"]')!;
const renderButton = app.querySelector<HTMLButtonElement>('[data-action="render"]')!;
const surfaces = createSurfacePanel(state, workspace, () => surfaceButton.classList.toggle('active', surfaces.isOpen()));
const images = createImagesPanel(state, workspace, () => imagesButton.classList.toggle('active', images.isOpen()));
const uvEditor = createUvEditor(state, workspace, () => uvButton.classList.toggle('active', uvEditor.isOpen()));
const paletteEditor = createPaletteEditor(state, workspace, () => paletteButton.classList.toggle('active', paletteEditor.isOpen()));
const arrayPanel = createArrayPanel(state, workspace, () => arrayButton.classList.toggle('active', arrayPanel.isOpen()));
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
    hiddenLayers: [...state.hiddenLayers].sort((a, b) => a - b),
  }),
  apply: (e) => {
    state.setMode(e.selectMode);
    state.setPivot(e.customPivot);
    state.hiddenLayers.clear();
    for (const i of e.hiddenLayers ?? []) if (i !== state.activeLayer) state.hiddenLayers.add(i);
    state.changed();
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
const files = createFileActions(state, display, app.querySelector<HTMLInputElement>('#file-input')!, app.querySelector<HTMLInputElement>('#obj-input')!, app.querySelector<HTMLInputElement>('#mtl-input')!, createMtlPrompt(document.body), editorBridge, notify, showViewMode, () => fitAll());

/** Centre every view on the whole model and zoom to show all of it; with nothing to show, back to the default cameras. */
function fitAll(): void {
  const box = boundsOf(state.layers.flatMap((layer, i) => (state.isLayerHidden(i) ? [] : layer.points)));
  for (const { vp } of viewports) {
    if (box) vp.frame(box);
    else vp.resetView();
  }
}

/** Open the mascot, or the demo box if it cannot be loaded, so the editor never starts empty and broken. */
async function openStartupProject(): Promise<void> {
  try {
    const response = await fetch(mascotUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (files.openProject('mascot.vmesh', await response.arrayBuffer(), { untitled: true })) return void fitAll();
  } catch (err) {
    notify(`Could not load the startup model: ${err instanceof Error ? err.message : 'unexpected error'}`, true);
  }
  state.setMesh(demoBox);
}
if (!startBlank) void openStartupProject();
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
  importObj: () => files.importObj(),
  exportObj: () => files.exportObj(),
  numeric: () => numeric.toggle(),
  position: () => positionPanel.toggle(),
  stats: () => statsPanel.toggle(),
  surface: () => surfaces.toggle(),
  images: () => images.toggle(),
  uv: () => uvEditor.toggle(),
  palette: () => paletteEditor.toggle(),
  array: () => arrayPanel.toggle(),
  mirror: () => mirrorPanel.toggle(),
  boolean: () => booleanPanel.toggle(),
  render: () => renderSettings.toggle(),
  all: () => state.selectAll(),
  invert: () => state.invertSelection(),
  none: () => state.clearSelection(),
  fit: () => fitAll(),
  facing: () => {
    hideHidden = !hideHidden;
    facingButton.classList.toggle('active', hideHidden);
    try {
      localStorage.setItem('vapormesh.hideHidden', String(hideHidden));
    } catch {}
  },
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
  solo: () => soloLayer(state),
  showLayers: () => showAllLayers(state),
};
app.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((b) =>
  b.addEventListener('click', () => {
    const r = SELECT_ACTIONS[b.dataset.select!]!();
    notify(r.message, !r.ok);
  }),
);
const snapSelect = app.querySelector<HTMLSelectElement>('[data-snap]')!;
snapSelect.addEventListener('change', () => {
  state.setSnap(Number(snapSelect.value));
  try {
    localStorage.setItem('vapormesh.snap', String(state.snap));
  } catch {
    /* private window or blocked storage: the choice just is not remembered */
  }
});
try {
  // the last choice, if it is still one of the menu's steps
  const saved = Number(localStorage.getItem('vapormesh.snap'));
  if (localStorage.getItem('vapormesh.snap') !== null && SNAPS.some(([v]) => v === saved)) state.setSnap(saved);
} catch {
  /* as above */
}
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
  axisButtons.forEach((b, k) => b.classList.toggle('active', state.axes[k]!));
  selectButton.classList.toggle('active', activeTool === null);
  snapSelect.value = String(state.snap);
  primitiveButtons.forEach((b) => b.classList.toggle('active', b.dataset.create === state.createOp));
  layerButtons.forEach((b, i) => {
    b.classList.toggle('active', i === state.activeLayer);
    b.classList.toggle('filled', state.layers[i]!.points.length > 0);
    b.classList.toggle('off', state.isLayerHidden(i));
    b.title = `Layer ${i + 1}${state.isLayerHidden(i) ? ' (hidden)' : ''}: click to edit, Shift-click to ${state.isLayerHidden(i) ? 'show' : 'hide'}`;
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
    if (key === 'f') runEdit('make');
    if (key === 'h') {
      const r = e.shiftKey ? hideSelection(state, true) : toggleHidden(state);
      notify(r.message, !r.ok);
    }
    if (key === 'a') fitAll();
    if (!e.altKey && (key === 'x' || key === 'y' || key === 'z')) state.toggleAxis(({ x: 0, y: 1, z: 2 } as const)[key]);
    if (key === 'n') numeric.toggle();
    if (key === 'i') positionPanel.toggle();
    if (key === 'j') statsPanel.toggle();
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
  const sideMenu = c.parentElement!.querySelector<HTMLSelectElement>('select.side');
  sideMenu?.addEventListener('change', () => {
    vp.setSide(sideMenu.value as ViewSide);
    sideMenu.blur(); // keep the tool hotkeys working
  });
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
      return activeDragTool() === null || state.activeTool === 'knife';
    },
    get bandShape() {
      return state.activeTool === 'knife' ? ('line' as const) : state.lasso ? ('lasso' as const) : ('box' as const);
    },
    begin: (v, e, press) => {
      selectingInstead = !!state.activeTool && SELECTION_TOOLS.includes(state.activeTool) && state.selection.size === 0;
      const tool = activeDragTool();
      // Shift-drag pans, except with the knife, where it straightens the line
      return tool ? (!e.shiftKey || state.activeTool === 'knife') && tool.begin(v, press) : v.isOrtho;
    },
    move: (i) => activeDragTool()?.move(i),
    end: (i) => {
      const tool = activeDragTool();
      if (tool) tool.end(i);
      else boxSelect(vp, i);
      selectingInstead = false;
    },
    cancel: () => {
      activeDragTool()?.cancel();
      selectingInstead = false;
    },
  };
  return { vp, view, shaded };
});

state.changed();

function frame() {
  for (const { vp, view, shaded } of viewports) {
    view.update(hideHidden);
    vp.palette = state.palette;
    if (shaded && display.mode !== 'wire') shaded.update();
    vp.resize();
    vp.render();
  }
  requestAnimationFrame(frame);
}
frame();

// Browser tests read and set the model through this; it is not in the production build.
if (import.meta.env.DEV) (window as unknown as { __vapormesh: unknown }).__vapormesh = { state, viewports, fitAll };
