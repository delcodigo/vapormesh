import { decodeProject, encodeProject, exportObj, ObjFormatError, parseMtl, parseObj, ProjectFormatError, type EditorState } from '@/io';
import { addMeshesToLayers, type ModelerState } from '@/modeler';
import type { DisplaySettings } from '@/render';
import { downloadBlob } from './download';
import type { MtlPromptInfo } from './mtlPrompt';

const EXTENSION = '.vmesh';

/** How the file actions reach the parts of the editor that aren't the model: the viewport cameras and so on. */
export interface EditorBridge {
  capture(): EditorState;
  apply(editor: EditorState): void;
  /** Back to the defaults, for a new project. */
  reset(): void;
}

export interface FileActions {
  newProject(): void;
  save(): void;
  load(): void;
  /** Pick an .obj (and optionally its .mtl) and add it to empty layers. */
  importObj(): void;
  /** Download the model as .obj plus a .mtl of its materials. */
  exportObj(): void;
  /** True if the model has changed since it was last saved or loaded. */
  isDirty(): boolean;
}

/**
 * Save and load VaporMesh projects through the browser: Save downloads a .vmesh file, Load opens one through
 * `input` (a hidden file input owned by the page). Asks before discarding unsaved work.
 */
export function createFileActions(
  state: ModelerState,
  display: DisplaySettings,
  input: HTMLInputElement,
  objInput: HTMLInputElement,
  mtlInput: HTMLInputElement,
  askForMtl: (info: MtlPromptInfo, onPick: () => void, onSkip: () => void) => void,
  editor: EditorBridge,
  notify: (message: string, isError?: boolean) => void,
  onLoaded: () => void,
): FileActions {
  let fileName = `untitled${EXTENSION}`;
  let savedRevision = state.history.revision;

  const isDirty = () => state.history.revision !== savedRevision;
  const confirmDiscard = () => !isDirty() || confirm('Discard your unsaved changes?');

  const newProject = () => {
    if (!confirmDiscard()) return;
    state.loadLayers([], 0);
    editor.reset();
    fileName = `untitled${EXTENSION}`;
    savedRevision = state.history.revision;
    notify('New project');
  };

  const save = () => {
    const data = encodeProject({
      layers: state.layers,
      activeLayer: state.activeLayer,
      display,
      palette: state.palette,
      images: state.images,
      editor: editor.capture(),
    });
    downloadBlob(fileName, data);
    savedRevision = state.history.revision;
    notify(`Saved ${fileName} (${(data.byteLength / 1024).toFixed(1)} KB)`);
  };

  const load = () => {
    if (confirmDiscard()) input.click();
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // let the same file be picked again later
    if (!file) return;
    try {
      const project = decodeProject(await file.arrayBuffer());
      state.loadLayers(project.layers, project.activeLayer, { palette: project.palette, images: project.images });
      display.mode = project.display.mode;
      Object.assign(display.retro, project.display.retro);
      if (project.editor) editor.apply(project.editor);
      fileName = file.name.toLowerCase().endsWith(EXTENSION) ? file.name : file.name + EXTENSION;
      savedRevision = state.history.revision;
      onLoaded();
      notify(`Loaded ${file.name}`);
    } catch (err) {
      // Nothing has been changed: decoding finishes before the model is touched.
      notify(`Could not load ${file.name}: ${err instanceof ProjectFormatError ? err.message : 'unexpected error'}`, true);
    }
  });

  const baseName = () => fileName.replace(/\.vmesh$/i, '');

  const exportObjFiles = () => {
    const base = baseName();
    const { obj, mtl, polygons } = exportObj(state.layers, state.palette, `${base}.mtl`);
    if (polygons === 0) return notify('Nothing to export: there are no polygons yet', true);
    downloadBlob(`${base}.obj`, obj, 'text/plain');
    downloadBlob(`${base}.mtl`, mtl, 'text/plain');
    notify(`Exported ${base}.obj and ${base}.mtl (${polygons} polygons; textures are not included)`);
  };

  const MAX_OBJ_BYTES = 50 * 1024 * 1024;

  /** Add an OBJ (already read) to the model, with the colours of its .mtl if there is one. */
  const importObjText = async (objName: string, text: string, mtlFile?: File) => {
    try {
      if (mtlFile && mtlFile.size > MAX_OBJ_BYTES) return notify(`${mtlFile.name} is too large (over 50 MB)`, true);
      const materials = mtlFile ? parseMtl(await mtlFile.text()) : undefined;
      const parsed = parseObj(text, state.palette, materials);
      const placed = addMeshesToLayers(state, parsed.groups);
      const count = parsed.groups.reduce((n, g) => n + g.mesh.polygons.length, 0);
      const where = placed.layers.length === 1 ? `layer ${placed.layers[0]! + 1}` : `layers ${placed.layers.map((l) => l + 1).join(', ')}`;
      const notes = [
        parsed.skippedFaces ? `${parsed.skippedFaces} unusable faces skipped` : '',
        parsed.ignoredLines ? `${parsed.ignoredLines} lines ignored (lines, points, curves)` : '',
        placed.merged ? `${placed.merged} objects merged for lack of empty layers` : '',
        !mtlFile ? 'no .mtl: surfaces are uncoloured' : '',
      ].filter(Boolean);
      notify(`Imported ${objName}: ${count} polygons into ${where}${notes.length ? ` (${notes.join('; ')})` : ''}`);
    } catch (err) {
      notify(`Could not import ${objName}: ${err instanceof ObjFormatError ? err.message : 'unexpected error'}`, true);
    }
  };

  // A page cannot open the .mtl sitting next to the .obj, so when the .obj wants one and only it was picked, ask for the .mtl.
  let waiting: { name: string; text: string } | null = null;
  const finishWaiting = (mtlFile?: File) => {
    const pending = waiting;
    waiting = null;
    if (pending) void importObjText(pending.name, pending.text, mtlFile);
  };
  mtlInput.addEventListener('change', () => {
    const file = mtlInput.files?.[0];
    mtlInput.value = '';
    finishWaiting(file);
  });
  mtlInput.addEventListener('cancel', () => finishWaiting()); // dismissed the picker: import without colours

  objInput.addEventListener('change', async () => {
    const files = [...(objInput.files ?? [])];
    objInput.value = '';
    const objFile = files.find((f) => /\.obj$/i.test(f.name));
    const mtlFile = files.find((f) => /\.mtl$/i.test(f.name));
    if (!objFile) return notify('Pick a .obj file (and its .mtl too, for colours)', true);
    if (objFile.size > MAX_OBJ_BYTES) return notify(`${objFile.name} is too large (over 50 MB)`, true);
    const text = await objFile.text();
    const wanted = /^\s*mtllib\s+(.+?)\s*$/m.exec(text)?.[1];
    if (!mtlFile && wanted && /^\s*usemtl\s/m.test(text)) {
      waiting = { name: objFile.name, text };
      // the second picker must open from a click on the dialog, not from here: see createMtlPrompt
      askForMtl({ objName: objFile.name, mtlName: wanted }, () => mtlInput.click(), () => finishWaiting());
      return;
    }
    await importObjText(objFile.name, text, mtlFile);
  });

  return { newProject, save, load, importObj: () => objInput.click(), exportObj: exportObjFiles, isDirty };
}
