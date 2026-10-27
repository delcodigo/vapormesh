import {
  convertToIndexed,
  nearestValidSize,
  type ColorMatch,
  type IndexedImage,
  type Palette,
  type ResampleMethod,
  type RgbaImage,
} from '@/core';
import {
  AddImageCommand,
  imageUsage,
  RemoveImageCommand,
  RenameImageCommand,
  uniqueImageName,
  validateImageName,
  type ModelerState,
} from '@/modeler';
import { makeDraggable } from './draggable';

const SIZES = [8, 16, 32, 64, 128, 256];
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_SIDE = 4096;
const PREVIEW_PIXELS = 128;

/** Draw an indexed image through a palette onto a canvas of the image's own size. */
export function paintImage(canvas: HTMLCanvasElement, image: IndexedImage, palette: Palette): void {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(image.width, image.height);
  for (let i = 0; i < image.pixels.length; i++) {
    const c = image.pixels[i]! * 3;
    data.data.set([palette[c]!, palette[c + 1]!, palette[c + 2]!, 255], i * 4);
  }
  ctx.putImageData(data, 0, 0);
}

/** Read any picture the browser can decode into RGBA, within sane limits. */
async function decodeImageFile(file: File): Promise<RgbaImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That file is too large (the limit is 32 MB)');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none' });
  } catch {
    throw new Error('That file is not a picture the browser can read');
  }
  try {
    if (bitmap.width > MAX_SOURCE_SIDE || bitmap.height > MAX_SOURCE_SIDE) {
      throw new Error(`That picture is too large (the limit is ${MAX_SOURCE_SIDE}x${MAX_SOURCE_SIDE})`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data };
  } finally {
    bitmap.close();
  }
}

const option = (value: string | number, label: string) => new Option(label, String(value));

export interface ImagesPanel {
  toggle(): void;
  isOpen(): boolean;
}

/**
 * Lists the project's images and imports pictures into the project palette, with a live preview of the result.
 * Names come from files, so everything here is built with DOM calls and textContent, never innerHTML.
 */
export function createImagesPanel(state: ModelerState, host: HTMLElement, onToggle: () => void): ImagesPanel {
  const el = document.createElement('div');
  el.className = 'numeric images';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span>Images</span><button data-act="close" title="Close">×</button></div>
    <div class="numeric-actions"><button data-act="import" title="Import a picture, or drop one on this panel">Import…</button></div>
    <input type="file" accept="image/png,image/gif,image/jpeg,image/webp" hidden data-f="file">
    <div class="image-list"></div>
    <div class="msg" role="status"></div>
    <div class="import" hidden>
      <div class="numeric-heading"><span data-f="source"></span></div>
      <canvas class="preview"></canvas>
      <div class="numeric-row"><input type="text" data-f="name" placeholder="Name" spellcheck="false"></div>
      <div class="numeric-row"><label>W<select data-f="width"></select></label><label>H<select data-f="height"></select></label></div>
      <div class="slider-row"><span class="name">Resize</span><select data-f="resample"></select></div>
      <div class="slider-row"><span class="name">Colors</span><select data-f="match"></select></div>
      <div class="hint" data-f="note"></div>
      <div class="numeric-actions"><button data-act="add">Add</button><button data-act="cancel">Cancel</button></div>
    </div>`;
  host.appendChild(el);
  makeDraggable(el);

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const list = q<HTMLElement>('.image-list');
  const msg = q<HTMLElement>('.msg');
  const fileInput = q<HTMLInputElement>('[data-f="file"]');
  const importBox = q<HTMLElement>('.import');
  const preview = q<HTMLCanvasElement>('canvas.preview');
  const nameInput = q<HTMLInputElement>('[data-f="name"]');
  const widthSel = q<HTMLSelectElement>('[data-f="width"]');
  const heightSel = q<HTMLSelectElement>('[data-f="height"]');
  const resampleSel = q<HTMLSelectElement>('[data-f="resample"]');
  const matchSel = q<HTMLSelectElement>('[data-f="match"]');
  const note = q<HTMLElement>('[data-f="note"]');
  const source = q<HTMLElement>('[data-f="source"]');

  widthSel.replaceChildren(...SIZES.map((n) => option(n, String(n))));
  heightSel.replaceChildren(...SIZES.map((n) => option(n, String(n))));
  resampleSel.replaceChildren(option('average', 'Smooth (average)'), option('nearest', 'Sharp (nearest)'));
  matchSel.replaceChildren(option('nearest', 'Snap to nearest'), option('ordered', 'Dither (ordered)'), option('diffusion', 'Dither (diffusion)'));

  let pending: { fileName: string; picture: RgbaImage; hasAlpha: boolean } | null = null;
  let renaming: IndexedImage | null = null;
  let listKey = '';

  const say = (text: string, isError = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', isError);
  };

  // --- the list ---------------------------------------------------------

  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const idOf = (o: object) => {
    if (!ids.has(o)) ids.set(o, ++nextId);
    return ids.get(o)!;
  };

  const renderList = (force = false) => {
    const key = [idOf(state.palette), ...state.images.map((i) => `${idOf(i)}:${imageUsage(state, i.name)}`)].join('|');
    if (!force && key === listKey) return;
    listKey = key;
    if (state.images.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'No images yet. Import one.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...state.images.map((image, index) => {
        const row = document.createElement('div');
        row.className = 'image-row';
        row.dataset.index = String(index);
        const thumb = document.createElement('canvas');
        thumb.className = 'thumb';
        paintImage(thumb, image, state.palette);
        const info = document.createElement('div');
        info.className = 'image-info';
        const name = document.createElement('span');
        name.className = 'image-name';
        name.textContent = image.name;
        name.title = image.name;
        const used = imageUsage(state, image.name);
        const meta = document.createElement('span');
        meta.className = 'image-meta';
        meta.textContent = `${image.width}×${image.height} · ${used === 0 ? 'unused' : `${used} surface${used === 1 ? '' : 's'}`}`;
        info.append(name, meta);
        const rename = document.createElement('button');
        rename.dataset.act = 'rename';
        rename.title = 'Rename';
        rename.textContent = '✎';
        const remove = document.createElement('button');
        remove.dataset.act = 'delete';
        remove.title = 'Delete';
        remove.textContent = '✕';
        row.append(thumb, info, rename, remove);
        return row;
      }),
    );
  };

  const startRename = (row: HTMLElement, image: IndexedImage) => {
    const label = row.querySelector<HTMLElement>('.image-name')!;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = image.name;
    input.spellcheck = false;
    label.replaceWith(input);
    renaming = image;
    input.focus();
    input.select();
    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      if (commit) {
        const error = validateImageName(state.images, input.value, image);
        if (error) {
          input.classList.add('invalid');
          say(error, true);
          return; // keep editing
        }
        if (input.value.trim() !== image.name) state.execute(new RenameImageCommand(state, image, input.value));
      }
      finished = true;
      renaming = null;
      say('');
      renderList(true);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(false));
  };

  const removeImage = (image: IndexedImage) => {
    const used = imageUsage(state, image.name);
    if (used > 0 && !confirm(`"${image.name}" is used by ${used} surface${used === 1 ? '' : 's'}. Delete it anyway?`)) return;
    state.execute(new RemoveImageCommand(state, image));
    say(`Deleted "${image.name}"${used ? ' (undo brings it back)' : ''}`);
  };

  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    const row = target.closest<HTMLElement>('.image-row');
    const image = row ? state.images[Number(row.dataset.index)] : undefined;
    if (!row || !image) return;
    if (act === 'rename') startRename(row, image);
    else if (act === 'delete') removeImage(image);
  });

  // --- importing --------------------------------------------------------

  const conversion = () =>
    convertToIndexed(pending!.picture, {
      name: nameInput.value.trim() || 'preview',
      width: Number(widthSel.value),
      height: Number(heightSel.value),
      palette: state.palette,
      resample: resampleSel.value as ResampleMethod,
      match: matchSel.value as ColorMatch,
    });

  const updatePreview = () => {
    if (!pending) return;
    const result = conversion();
    paintImage(preview, result, state.palette);
    const scale = Math.max(1, Math.floor(PREVIEW_PIXELS / Math.max(result.width, result.height)));
    preview.style.width = `${result.width * scale}px`;
    preview.style.height = `${result.height * scale}px`;
    const { picture } = pending;
    source.textContent = `${pending.fileName} · ${picture.width}×${picture.height} → ${result.width}×${result.height}`;
    const notes = [];
    if (pending.hasAlpha) notes.push('Transparent areas become black.');
    if (matchSel.value === 'ordered') notes.push('Colors already in the palette are kept.');
    note.textContent = notes.join(' ');
  };

  const startImport = (fileName: string, picture: RgbaImage) => {
    let hasAlpha = false;
    for (let i = 3; i < picture.data.length; i += 4) {
      if (picture.data[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }
    pending = { fileName, picture, hasAlpha };
    nameInput.value = uniqueImageName(state.images, fileName.replace(/\.[^.]+$/, ''));
    nameInput.classList.remove('invalid');
    widthSel.value = String(nearestValidSize(picture.width));
    heightSel.value = String(nearestValidSize(picture.height));
    importBox.hidden = false;
    say('');
    updatePreview();
  };

  const closeImport = () => {
    pending = null;
    importBox.hidden = true;
  };

  const loadFile = async (file: File) => {
    try {
      startImport(file.name, await decodeImageFile(file));
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not read that file', true);
    }
  };

  const addImage = () => {
    if (!pending) return;
    const error = validateImageName(state.images, nameInput.value);
    nameInput.classList.toggle('invalid', error !== null);
    if (error) return say(error, true);
    const image = { ...conversion(), name: nameInput.value.trim() };
    state.execute(new AddImageCommand(state, image));
    say(`Added "${image.name}" (${image.width}×${image.height})`);
    closeImport();
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void loadFile(file);
  });
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });
  for (const control of [widthSel, heightSel, resampleSel, matchSel]) control.addEventListener('change', updatePreview);
  nameInput.addEventListener('input', () => nameInput.classList.remove('invalid'));
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && addImage());

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') toggle();
    else if (act === 'import') fileInput.click();
    else if (act === 'add') addImage();
    else if (act === 'cancel') closeImport();
  });

  state.subscribe(() => {
    if (!el.hidden && renaming === null) renderList();
  });

  function toggle(): void {
    el.hidden = !el.hidden;
    if (!el.hidden) renderList(true);
    onToggle();
  }

  return { toggle, isOpen: () => !el.hidden };
}
