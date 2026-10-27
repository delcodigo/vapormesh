/**
 * Dropdown menus in the menu bar. The markup is `.menuwrap` > a `[data-menu]` title button + a `.dropdown` of
 * `[role=menuitem]` buttons; the items do their own work through their own handlers, this only opens and closes.
 * Click the title to open, click an item, click elsewhere or press Escape to close; Up/Down move between items.
 */
export function setupMenus(root: HTMLElement): void {
  const wraps = [...root.querySelectorAll<HTMLElement>('.menuwrap')];

  const parts = (wrap: HTMLElement) => ({
    title: wrap.querySelector<HTMLButtonElement>('[data-menu]')!,
    drop: wrap.querySelector<HTMLElement>('.dropdown')!,
    items: [...wrap.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],
  });
  const setOpen = (wrap: HTMLElement, open: boolean, focusItem = false) => {
    const { title, drop, items } = parts(wrap);
    drop.hidden = !open;
    title.setAttribute('aria-expanded', String(open));
    title.classList.toggle('open', open);
    if (open && focusItem) items[0]?.focus();
  };
  const closeAll = () => wraps.forEach((w) => setOpen(w, false));

  for (const wrap of wraps) {
    const { title, drop, items } = parts(wrap);
    title.addEventListener('click', () => {
      const wasOpen = !drop.hidden;
      closeAll();
      setOpen(wrap, !wasOpen);
    });
    // dropping from the keyboard
    title.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        closeAll();
        setOpen(wrap, true, true);
      }
    });
    drop.addEventListener('click', () => setOpen(wrap, false));
    drop.addEventListener('keydown', (e) => {
      // keys inside an open menu belong to the menu: the editor's shortcuts (Space clears the selection, M is Move...) must not fire
      e.stopPropagation();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
      else if (e.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
      else if (e.key === 'Escape') {
        setOpen(wrap, false);
        title.focus();
      } else return;
      e.preventDefault();
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as HTMLElement).closest('.menuwrap')) closeAll();
  });
  window.addEventListener('blur', closeAll);
  // Escape closes an open menu even when it was opened with the mouse and focus is elsewhere
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wraps.some((w) => !parts(w).drop.hidden)) closeAll();
  });
}
