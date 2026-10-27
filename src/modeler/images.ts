import type { IndexedImage } from '@/core';
import type { Command } from './history';
import type { ModelerState } from './state';

const MAX_NAME_LENGTH = 64;

/** Why `name` can't be used for an image, or null if it can. `ignore` is the image being renamed. */
export function validateImageName(images: readonly IndexedImage[], name: string, ignore?: IndexedImage): string | null {
  const n = name.trim();
  if (!n) return 'Give the image a name';
  if (n.length > MAX_NAME_LENGTH) return `Names are at most ${MAX_NAME_LENGTH} characters`;
  if (images.some((i) => i !== ignore && i.name === n)) return `There is already an image named "${n}"`;
  return null;
}

/** `desired`, or `desired 2`, `desired 3`... if it is taken. */
export function uniqueImageName(images: readonly IndexedImage[], desired: string): string {
  const base = desired.trim().slice(0, MAX_NAME_LENGTH - 4) || 'Image';
  let name = base;
  for (let n = 2; images.some((i) => i.name === name); n++) name = `${base} ${n}`;
  return name;
}

/** How many surfaces, across all layers, use the image. */
export function imageUsage(state: ModelerState, name: string): number {
  return state.layers.reduce((n, layer) => n + layer.surfaces.filter((s) => s.texture === name).length, 0);
}

export class AddImageCommand implements Command {
  readonly label: string;

  constructor(
    private state: ModelerState,
    private image: IndexedImage,
  ) {
    this.label = `Add Image "${image.name}"`;
  }

  redo(): void {
    this.state.images = [...this.state.images, this.image];
  }

  undo(): void {
    this.state.images = this.state.images.filter((i) => i !== this.image);
  }
}

/** Remove an image. Surfaces that use it keep the name, so undoing (or adding it back) reconnects them. */
export class RemoveImageCommand implements Command {
  readonly label: string;
  private index = 0;

  constructor(
    private state: ModelerState,
    private image: IndexedImage,
  ) {
    this.label = `Delete Image "${image.name}"`;
  }

  redo(): void {
    this.index = Math.max(this.state.images.indexOf(this.image), 0);
    this.state.images = this.state.images.filter((i) => i !== this.image);
  }

  undo(): void {
    const next = [...this.state.images];
    next.splice(this.index, 0, this.image);
    this.state.images = next;
  }
}

/** Rename an image and every surface that refers to it, so no texture silently disconnects. */
export class RenameImageCommand implements Command {
  readonly label: string;
  private renamed: IndexedImage;
  /** Layer and surface indices that used the old name. Indices, not objects: panels replace surface objects. */
  private users: [layer: number, surface: number][] = [];

  constructor(
    private state: ModelerState,
    private image: IndexedImage,
    name: string,
  ) {
    this.label = `Rename Image "${image.name}"`;
    this.renamed = { ...image, name: name.trim() };
    state.layers.forEach((layer, li) =>
      layer.surfaces.forEach((s, si) => {
        if (s.texture === image.name) this.users.push([li, si]);
      }),
    );
  }

  redo(): void {
    this.swap(this.image, this.renamed);
  }

  undo(): void {
    this.swap(this.renamed, this.image);
  }

  private swap(from: IndexedImage, to: IndexedImage): void {
    this.state.images = this.state.images.map((i) => (i === from ? to : i));
    for (const [li, si] of this.users) {
      const surface = this.state.layers[li]?.surfaces[si];
      if (surface) surface.texture = to.name;
    }
  }
}
