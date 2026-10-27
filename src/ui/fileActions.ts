import { decodeProject, encodeProject, ProjectFormatError } from '@/io';
import type { ModelerState } from '@/modeler';
import type { DisplaySettings } from '@/render';

const EXTENSION = '.vmesh';

export interface FileActions {
  newProject(): void;
  save(): void;
  load(): void;
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
    fileName = `untitled${EXTENSION}`;
    savedRevision = state.history.revision;
    notify('New project');
  };

  const save = () => {
    const data = encodeProject({ layers: state.layers, activeLayer: state.activeLayer, display });
    const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
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
      state.loadLayers(project.layers, project.activeLayer);
      display.mode = project.display.mode;
      Object.assign(display.retro, project.display.retro);
      fileName = file.name.toLowerCase().endsWith(EXTENSION) ? file.name : file.name + EXTENSION;
      savedRevision = state.history.revision;
      onLoaded();
      notify(`Loaded ${file.name}`);
    } catch (err) {
      // Nothing has been changed: decoding finishes before the model is touched.
      notify(`Could not load ${file.name}: ${err instanceof ProjectFormatError ? err.message : 'unexpected error'}`, true);
    }
  });

  return { newProject, save, load, isDirty };
}
