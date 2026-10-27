import './style.css';
import { box, ModelerState, MoveTool, type SelectMode, type ToolName } from '@/modeler';
import { MeshView, pickPoint, pickPolygon, Viewport, type ViewKind } from '@/render';

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
const TOOLS: [ToolName, string][] = [['move', 'Move']];

const state = new ModelerState(box(1, 1, 1));
const move = new MoveTool(state);

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="menubar">WebWave 3D &nbsp; | &nbsp; Modeler &nbsp; Layout</div>
  <div class="workspace">
    <div class="toolpanel">
      <div class="section">Position</div>
      ${TOOLS.map(([t, label]) => `<button data-tool="${t}">${label}</button>`).join('')}
    </div>
    <div class="viewports">
      ${VIEWS.map(([, n]) => `<div class="viewport"><canvas></canvas><span class="label">${n}</span></div>`).join('')}
    </div>
  </div>
  <div class="bottombar">
    ${MODES.map(([m, label]) => `<button data-mode="${m}">${label}</button>`).join('')}
    <span class="readout"></span>
    <span class="spacer"></span>
    <button id="redo">Redo</button>
    <button id="undo">Undo</button>
  </div>`;

const readout = app.querySelector<HTMLElement>('.readout')!;
const modeButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-mode]')];
const toolButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-tool]')];
const undoButton = app.querySelector<HTMLButtonElement>('#undo')!;
const redoButton = app.querySelector<HTMLButtonElement>('#redo')!;

modeButtons.forEach((b) => b.addEventListener('click', () => state.setMode(b.dataset.mode as SelectMode)));
toolButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const tool = b.dataset.tool as ToolName;
    state.setTool(state.activeTool === tool ? null : tool);
  }),
);
undoButton.addEventListener('click', () => state.undo());
redoButton.addEventListener('click', () => state.redo());

state.subscribe(() => {
  const { mesh, mode, selection, activeTool, history } = state;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === activeTool));
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
  undoButton.title = history.undoLabel ?? '';
  redoButton.title = history.redoLabel ?? '';
  const total = mode === 'points' ? mesh.points.length : mesh.polygons.length;
  readout.textContent = `${selection.size} / ${total}`;
});

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) state.redo();
    else state.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    state.redo();
  } else if (e.key === ' ') {
    e.preventDefault();
    state.clearSelection();
  } else if (!mod) {
    for (const [m, , key] of MODES) if (e.key === key) state.setMode(m);
  }
});

const viewports = [...document.querySelectorAll('canvas')].map((c, i) => {
  const vp = new Viewport(c, VIEWS[i]![0]);
  const view = new MeshView(state);
  vp.scene.add(view.group);
  vp.onClick = (x, y, e) => {
    const id =
      state.mode === 'points' ? pickPoint(state.mesh, vp, x, y) : pickPolygon(state.mesh, vp, x, y);
    state.applyPick(id, e.shiftKey ? 'toggle' : 'replace');
  };
  vp.dragHandler = {
    begin: (v) => state.activeTool === 'move' && move.begin(v),
    move: (offset) => move.move(offset),
    end: () => move.end(),
  };
  return { vp, view };
});

state.changed();

function frame() {
  for (const { vp, view } of viewports) {
    view.update();
    vp.resize();
    vp.render();
  }
  requestAnimationFrame(frame);
}
frame();
