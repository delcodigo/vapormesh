const SECTIONS: [string, [string, string][]][] = [
  [
    'Tools',
    [
      ['Q M R S', 'Select, Move, Rotate, Size'],
      ['E K', 'Extrude, Knife (Shift: straight cut)'],
      ['1 2 P', 'Point mode, Polygon mode, switch'],
      ['X Y Z', 'Axis locks'],
      ['A', 'Fit every view to the model'],
    ],
  ],
  [
    'Panels',
    [
      ['N I U J', 'Numeric, Position, UV editor, Stats'],
      ['?', 'This cheat sheet'],
    ],
  ],
  [
    'Editing',
    [
      ['F', 'Make a polygon from the selected points'],
      ['Delete', 'Delete the selection'],
      ['H', 'Hide selection / show hidden'],
      ['Shift+H', 'Hide all but the selection'],
      ['Space', 'Clear the selection'],
      ['Ctrl+A / I', 'Select all / invert'],
      ['Ctrl+C X V', 'Copy, cut, paste'],
      ['Ctrl+Z / Y', 'Undo / redo'],
      ['Ctrl+S / O', 'Save / open'],
    ],
  ],
  [
    'Views',
    [
      ['Wheel', 'Zoom'],
      ['Middle / right drag, Shift+drag', 'Pan'],
      ['Left drag (Perspective)', 'Orbit'],
    ],
  ],
];

export interface CheatSheet {
  toggle(): void;
}

/** A list of the keys, shown over the workspace until you click anywhere. */
export function createCheatSheet(host: HTMLElement, button: HTMLElement): CheatSheet {
  const el = document.createElement('div');
  el.className = 'cheatsheet';
  el.hidden = true;
  el.innerHTML = `<div class="cheatsheet-title">Cheat sheet <span>click anywhere to close</span></div>${SECTIONS.map(
    ([title, rows]) =>
      `<h3>${title}</h3><dl>${rows.map(([k, d]) => `<dt>${k}</dt><dd>${d}</dd>`).join('')}</dl>`,
  ).join('')}`;
  host.appendChild(el);

  const close = () => {
    el.hidden = true;
    button.classList.remove('active');
  };
  // the button toggles itself, so a click on it is not also "anywhere"
  document.addEventListener('click', (e) => {
    if (!el.hidden && !button.contains(e.target as Node)) close();
  });
  return {
    toggle() {
      el.hidden = !el.hidden;
      button.classList.toggle('active', !el.hidden);
    },
  };
}
