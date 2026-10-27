/** Let a floating panel be moved by its title bar, staying inside its positioned parent. */
export function makeDraggable(panel: HTMLElement): void {
  const handle = panel.querySelector<HTMLElement>('.numeric-title');
  if (!handle) return;
  handle.style.cursor = 'move';
  handle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const host = (panel.offsetParent as HTMLElement).getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(ev.clientX - dx - host.left, 0), Math.max(host.width - box.width, 0));
      const y = Math.min(Math.max(ev.clientY - dy - host.top, 0), Math.max(host.height - box.height, 0));
      Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
