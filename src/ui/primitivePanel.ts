import {
  createPrimitive,
  defaultValues,
  isValidField,
  PRIMITIVES,
  type FieldSpec,
  type ModelerState,
  type PrimitiveName,
  type PrimitiveValues,
} from '@/modeler';

const AXIS_LABELS = ['X', 'Y', 'Z'];
const COUNT: Record<FieldSpec['kind'], number> = { size: 1, size3: 3, point3: 3, int: 1, int3: 3, axis: 1 };

function fieldHtml(f: FieldSpec): string {
  let control: string;
  if (f.kind === 'axis') {
    control = `<select data-key="${f.key}" data-i="0">${AXIS_LABELS.map((a, i) => `<option value="${i}">${a}</option>`).join('')}</select>`;
  } else if (COUNT[f.kind] === 1) {
    control = `<label><input data-key="${f.key}" data-i="0" inputmode="decimal" spellcheck="false"></label>`;
  } else {
    control = AXIS_LABELS.map(
      (a, i) => `<label>${a}<input data-key="${f.key}" data-i="${i}" inputmode="decimal" spellcheck="false"></label>`,
    ).join('');
  }
  return `<div class="numeric-group"><div class="numeric-heading"><span>${f.label}</span></div><div class="numeric-row">${control}</div></div>`;
}

export interface PrimitivePanel {
  open(name: PrimitiveName): void;
  close(): void;
}

/** Dialog for creating Box / Ball / Disc / Cone with exact parameters. Stays open so you can add several. */
export function createPrimitivePanel(state: ModelerState, host: HTMLElement): PrimitivePanel {
  const el = document.createElement('div');
  el.className = 'numeric create';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric-title"><span data-title></span><button data-act="close" title="Close">×</button></div>
    <div data-fields></div>
    <div class="numeric-group">
      <div class="numeric-heading"><span>Add to</span></div>
      <label class="choice"><input type="radio" name="dest" value="merge" checked> Current layer (merge)</label>
      <label class="choice"><input type="radio" name="dest" value="layer"> New layer</label>
    </div>
    <div class="numeric-actions"><button data-act="create">Create</button><button data-act="reset">Reset</button></div>`;
  host.appendChild(el);

  const fieldsEl = el.querySelector<HTMLElement>('[data-fields]')!;
  const newLayerRadio = el.querySelector<HTMLInputElement>('input[value="layer"]')!;
  const mergeRadio = el.querySelector<HTMLInputElement>('input[value="merge"]')!;
  const values = {} as Record<PrimitiveName, PrimitiveValues>;
  const strings = {} as Record<PrimitiveName, Record<string, string[]>>;
  let current: PrimitiveName = 'box';

  const controls = () => [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')];

  const render = (name: PrimitiveName) => {
    current = name;
    values[name] ??= defaultValues(name);
    strings[name] ??= Object.fromEntries(Object.entries(values[name]).map(([k, v]) => [k, v.map(String)]));
    el.querySelector('[data-title]')!.textContent = `Create ${PRIMITIVES[name].label}`;
    fieldsEl.innerHTML = PRIMITIVES[name].fields.map(fieldHtml).join('');
    for (const c of controls()) c.value = strings[name][c.dataset.key!]![Number(c.dataset.i)]!;
  };

  /** Read every field; flag the bad ones. Returns null if anything is invalid. */
  const parse = (): PrimitiveValues | null => {
    const out: PrimitiveValues = {};
    let ok = true;
    for (const f of PRIMITIVES[current].fields) {
      const inputs = controls().filter((c) => c.dataset.key === f.key);
      const nums = inputs.map((c) => (c.value.trim() === '' ? NaN : Number(c.value)));
      const valid = isValidField(f, nums);
      inputs.forEach((c) => c.classList.toggle('invalid', !valid));
      ok &&= valid;
      out[f.key] = nums;
    }
    return ok ? out : null;
  };

  const create = () => {
    const parsed = parse();
    if (!parsed) return;
    createPrimitive(state, current, parsed, newLayerRadio.checked ? 'layer' : 'merge');
  };

  const open = (name: PrimitiveName) => {
    el.hidden = false;
    render(name);
    state.setCreateOp(name);
  };
  const close = () => {
    el.hidden = true;
    state.setCreateOp(null);
  };

  el.addEventListener('input', (e) => {
    const c = e.target as HTMLInputElement | HTMLSelectElement;
    if (c.dataset.key) strings[current][c.dataset.key]![Number(c.dataset.i)] = c.value;
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).dataset.key) create();
  });
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'create') create();
    else if (act === 'reset') {
      values[current] = defaultValues(current);
      delete (strings as Partial<typeof strings>)[current];
      render(current);
    }
  });

  state.subscribe(() => {
    // "New layer" needs a free layer; otherwise it would silently merge.
    const free = state.firstEmptyLayer() !== null;
    newLayerRadio.disabled = !free;
    newLayerRadio.parentElement!.title = free ? '' : 'All ten layers are in use';
    if (!free && newLayerRadio.checked) mergeRadio.checked = true;
    // Closing from outside (e.g. another dialog) keeps the panel in step with the state.
    if (state.createOp === null && !el.hidden) el.hidden = true;
  });

  return { open, close };
}
