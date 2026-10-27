import { describe, expect, it } from 'vitest';
import { createImage, defaultPalette } from '@/core';
import { deleteSelection, extrudeSelection, pasteClipboard, copySelection } from './edit';
import { AddImageCommand } from './images';
import { SetPaletteCommand, setEntry } from './palette';
import { box } from './primitives';
import { ModelerState } from './state';
import { MoveTool } from './moveTool';

/** Two layers with a box each. */
function twoLayers() {
  const s = new ModelerState(box());
  s.layers[1]!.append(box());
  return s;
}
const view = { isOrtho: true, viewAxis: [0, 0, 1] as [number, number, number], project: () => ({ x: 0, y: 0 }) };

describe('undo and redo follow the edit to its layer', () => {
  it('undoing an edit made on another layer switches to that layer, and restores its selection there', () => {
    const s = twoLayers();
    s.applySelection([0], 'replace');
    deleteSelection(s); // an edit on layer 1
    s.setActiveLayer(1);
    s.applySelection([5], 'replace'); // a different selection, on layer 2
    expect(s.activeLayer).toBe(1);

    s.undo();
    expect(s.activeLayer).toBe(0); // it went to where the edit was made
    expect(s.layers[0]!.points).toHaveLength(8);
    expect([...s.selectedPoints]).toEqual([0]); // layer 1's selection, now on layer 1
    expect(s.layers[1]!.points).toHaveLength(8); // layer 2 untouched
  });

  it('redo goes back to the layer too', () => {
    const s = twoLayers();
    s.applySelection([0], 'replace');
    deleteSelection(s);
    s.setActiveLayer(1);
    s.undo(); // now on layer 1
    s.setActiveLayer(1);
    s.redo();
    expect(s.activeLayer).toBe(0);
    expect(s.layers[0]!.points).toHaveLength(7);
  });

  it('walks back through edits on different layers, switching as it goes', () => {
    const s = twoLayers();
    s.applySelection([0], 'replace');
    deleteSelection(s); // layer 1
    s.setActiveLayer(1);
    s.applySelection([0], 'replace');
    deleteSelection(s); // layer 2
    s.setActiveLayer(5);

    s.undo();
    expect(s.activeLayer).toBe(1);
    expect(s.layers[1]!.points).toHaveLength(8);
    s.undo();
    expect(s.activeLayer).toBe(0);
    expect(s.layers[0]!.points).toHaveLength(8);
  });

  it('works for drags, which keep their own command', () => {
    const s = twoLayers();
    const tool = new MoveTool(s);
    tool.begin(view);
    tool.move({ offset: [1, 0, 0], start: { x: 0, y: 0 }, current: { x: 0, y: 0 } });
    tool.end(); // moved layer 1
    s.setActiveLayer(3);
    s.undo();
    expect(s.activeLayer).toBe(0);
    expect(s.layers[0]!.points[0]).toEqual([-0.5, -0.5, -0.5]);
  });

  it('works for edits that change the point numbering', () => {
    const s = twoLayers();
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    extrudeSelection(s, { distance: 1, inset: 0, direction: 'normal' });
    s.setActiveLayer(2);
    s.undo();
    expect(s.activeLayer).toBe(0);
    expect(s.layers[0]!.polygons).toHaveLength(6);
  });
});

describe('edits that manage layers or the whole project keep their own behaviour', () => {
  it('a paste into a new layer: undo goes back to the layer you were on, as before', () => {
    const s = twoLayers();
    s.setMode('polygons');
    s.applySelection([0], 'replace');
    copySelection(s);
    s.setActiveLayer(4);
    pasteClipboard(s);
    expect(s.activeLayer).toBe(4);
    s.setActiveLayer(2);
    s.undo(); // the paste was on layer 5, but pastes put the cursor back where it was before them
    expect(s.layers[4]!.polygons).toHaveLength(0);
    expect(s.activeLayer).toBe(4);
    s.redo();
    expect(s.layers[4]!.polygons).toHaveLength(1);
  });

  it('a palette edit is project-wide: undoing it does not move you to another layer', () => {
    const s = twoLayers();
    s.setActiveLayer(3);
    s.execute(new SetPaletteCommand(s, 'Edit Color', setEntry(defaultPalette(), 5, [1, 2, 3])));
    s.setActiveLayer(6);
    s.undo();
    expect(s.activeLayer).toBe(6);
    s.redo();
    expect(s.activeLayer).toBe(6);
  });

  it('an image edit is project-wide too', () => {
    const s = twoLayers();
    s.execute(new AddImageCommand(s, createImage('X', 8, 8)));
    s.setActiveLayer(7);
    s.undo();
    expect(s.activeLayer).toBe(7);
    expect(s.images.some((i) => i.name === 'X')).toBe(false);
  });

  it('with nothing to undo, nothing moves', () => {
    const s = twoLayers();
    s.setActiveLayer(2);
    s.undo();
    s.redo();
    expect(s.activeLayer).toBe(2);
  });
});
