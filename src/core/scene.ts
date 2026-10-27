import { Envelope } from './envelope';
import type { Mesh } from './mesh';

export type ItemKind = 'object' | 'light' | 'camera' | 'null';

/** Layout item: has a motion (position/rotation/scale envelopes) and an optional parent. */
export class Item {
  readonly pos = [new Envelope(), new Envelope(), new Envelope()] as const;
  readonly rot = [new Envelope(), new Envelope(), new Envelope()] as const; // degrees H,P,B
  readonly scale = [new Envelope(), new Envelope(), new Envelope()] as const;
  parent: Item | null = null;

  constructor(
    public name: string,
    public kind: ItemKind,
    public mesh: Mesh | null = null,
  ) {}
}

export class Scene {
  items: Item[] = [];
  fps = 30;
  firstFrame = 0;
  lastFrame = 60;

  add(item: Item): Item {
    this.items.push(item);
    return item;
  }
}
