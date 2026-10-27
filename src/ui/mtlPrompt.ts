export interface MtlPromptInfo {
  objName: string;
  mtlName: string;
}

/**
 * The question "this OBJ takes its colours from a .mtl: pick it?". It is a dialog of our own, not `confirm()`, on purpose:
 * browsers only let a page open a file picker straight after a click, and a first picker has already used that up, so the
 * second one has to be opened from the click on this dialog's button, which `onPick` is called from synchronously.
 */
export function createMtlPrompt(host: HTMLElement): (info: MtlPromptInfo, onPick: () => void, onSkip: () => void) => void {
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.hidden = true;
  el.innerHTML = `
    <div class="numeric dialog mtl-dialog" role="dialog" aria-modal="true" aria-labelledby="mtl-title">
      <div class="numeric-title"><span id="mtl-title">Colours for this model</span></div>
      <div class="dialog-body"><span data-text></span></div>
      <div class="numeric-actions"><button data-act="pick"></button><button data-act="skip">Without colours</button></div>
    </div>`;
  host.appendChild(el);

  const text = el.querySelector<HTMLElement>('[data-text]')!;
  const pick = el.querySelector<HTMLButtonElement>('[data-act="pick"]')!;
  let onPick: () => void = () => {};
  let onSkip: () => void = () => {};

  const close = () => {
    el.hidden = true;
    document.removeEventListener('keydown', onKey, true);
  };
  const skip = () => {
    close();
    onSkip();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      skip();
    }
  };
  pick.addEventListener('click', () => {
    close();
    onPick(); // still inside the click, so the browser allows the file picker
  });
  el.querySelector('[data-act="skip"]')!.addEventListener('click', skip);
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el) skip();
  });

  return (info, pickHandler, skipHandler) => {
    onPick = pickHandler;
    onSkip = skipHandler;
    text.textContent = `${info.objName} takes its colours from ${info.mtlName}. Pick that file to import them, or import the model without colours.`;
    pick.textContent = `Pick ${info.mtlName}…`;
    el.hidden = false;
    document.addEventListener('keydown', onKey, true);
    pick.focus();
  };
}
