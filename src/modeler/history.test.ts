import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History.revision', () => {
  const cmd = { label: 'x', redo() {}, undo() {} };

  it('changes on every record, undo, redo and clear, and never repeats a value', () => {
    const h = new History();
    const seen = new Set([h.revision]);
    const step = () => {
      expect(seen.has(h.revision)).toBe(false);
      seen.add(h.revision);
    };
    h.record(cmd);
    step();
    h.undo();
    step();
    h.redo();
    step();
    h.clear();
    step();
  });

  it('is stable when nothing happens (undo with nothing to undo)', () => {
    const h = new History();
    const r = h.revision;
    h.undo();
    h.redo();
    expect(h.revision).toBe(r);
  });
});
