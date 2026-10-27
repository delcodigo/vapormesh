import { Mesh, type MeshSize } from '@/core';
import type { Command } from './history';
import { createBall, createBox, createCone, createDisc, type Axis } from './primitives';
import type { ModelerState } from './state';

export type PrimitiveName = 'box' | 'ball' | 'disc' | 'cone';

/**
 * How a dialog field is entered and validated:
 * size/size3 must be > 0 (a negative size would turn the shape inside out), point3 is any number,
 * int/int3 are whole numbers >= `min` (default 1), axis is an index into X, Y, Z.
 */
export type FieldKind = 'size' | 'size3' | 'point3' | 'int' | 'int3' | 'axis';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  defaults: number[];
  min?: number;
}

export type PrimitiveValues = Record<string, number[]>;

export interface PrimitiveSpec {
  label: string;
  fields: FieldSpec[];
  build(values: PrimitiveValues): Mesh;
}

const AXES: Axis[] = ['x', 'y', 'z'];
const center: FieldSpec = { key: 'center', label: 'Center', kind: 'point3', defaults: [0, 0, 0] };
const axis: FieldSpec = { key: 'axis', label: 'Axis', kind: 'axis', defaults: [1] };
const v3 = (a: number[]) => [a[0]!, a[1]!, a[2]!] as [number, number, number];

export const PRIMITIVES: Record<PrimitiveName, PrimitiveSpec> = {
  box: {
    label: 'Box',
    fields: [
      { key: 'size', label: 'Size', kind: 'size3', defaults: [1, 1, 1] },
      center,
      { key: 'segments', label: 'Segments', kind: 'int3', defaults: [1, 1, 1] },
    ],
    build: (v) => createBox({ size: v3(v.size!), center: v3(v.center!), segments: v3(v.segments!) }),
  },
  ball: {
    label: 'Ball',
    fields: [
      { key: 'radius', label: 'Radius', kind: 'size3', defaults: [0.5, 0.5, 0.5] },
      center,
      { key: 'sides', label: 'Sides', kind: 'int', defaults: [24], min: 3 },
      { key: 'segments', label: 'Segments', kind: 'int', defaults: [12], min: 2 },
      axis,
    ],
    build: (v) =>
      createBall({
        radius: v3(v.radius!),
        center: v3(v.center!),
        sides: v.sides![0]!,
        segments: v.segments![0]!,
        axis: AXES[v.axis![0]!]!,
      }),
  },
  disc: {
    label: 'Disc',
    fields: [
      { key: 'radius', label: 'Radius', kind: 'size', defaults: [0.5] },
      { key: 'height', label: 'Height', kind: 'size', defaults: [0.25] },
      center,
      { key: 'sides', label: 'Sides', kind: 'int', defaults: [24], min: 3 },
      { key: 'segments', label: 'Segments', kind: 'int', defaults: [1] },
      axis,
    ],
    build: (v) =>
      createDisc({
        radius: v.radius![0]!,
        height: v.height![0]!,
        center: v3(v.center!),
        sides: v.sides![0]!,
        segments: v.segments![0]!,
        axis: AXES[v.axis![0]!]!,
      }),
  },
  cone: {
    label: 'Cone',
    fields: [
      { key: 'radius', label: 'Radius', kind: 'size', defaults: [0.5] },
      { key: 'height', label: 'Height', kind: 'size', defaults: [1] },
      center,
      { key: 'sides', label: 'Sides', kind: 'int', defaults: [24], min: 3 },
      { key: 'segments', label: 'Segments', kind: 'int', defaults: [1] },
      axis,
    ],
    build: (v) =>
      createCone({
        radius: v.radius![0]!,
        height: v.height![0]!,
        center: v3(v.center!),
        sides: v.sides![0]!,
        segments: v.segments![0]!,
        axis: AXES[v.axis![0]!]!,
      }),
  },
};

export const PRIMITIVE_NAMES = Object.keys(PRIMITIVES) as PrimitiveName[];

/** Default values for a primitive's fields. */
export function defaultValues(name: PrimitiveName): PrimitiveValues {
  return Object.fromEntries(PRIMITIVES[name].fields.map((f) => [f.key, [...f.defaults]]));
}

/** Check one field's numbers against its kind. */
export function isValidField(field: FieldSpec, nums: number[]): boolean {
  if (!nums.every(Number.isFinite)) return false;
  switch (field.kind) {
    case 'size':
    case 'size3':
      return nums.every((n) => n > 0);
    case 'int':
    case 'int3':
      return nums.every((n) => Number.isInteger(n) && n >= (field.min ?? 1));
    case 'axis':
      return Number.isInteger(nums[0]) && nums[0]! >= 0 && nums[0]! < AXES.length;
    case 'point3':
      return true;
  }
}

/** Adds a primitive to a layer. Undo cuts the geometry back out and returns to the layer that was active. */
export class AddPrimitiveCommand implements Command {
  readonly projectWide = true;
  private size: MeshSize | null = null;
  private previousLayer = 0;

  constructor(
    private state: ModelerState,
    private primitive: Mesh,
    private layer: number,
    readonly label: string,
  ) {}

  redo(): void {
    this.previousLayer = this.state.activeLayer;
    this.state.setActiveLayer(this.layer);
    this.size = this.state.mesh.append(this.primitive);
  }

  undo(): void {
    this.state.layers[this.layer]!.truncate(this.size!);
    this.state.setActiveLayer(this.previousLayer);
  }
}

/**
 * Build a primitive and add it, either into the active layer ("merge") or into the first empty layer
 * (falling back to merging when every layer is in use). Returns the layer it went into.
 */
export function createPrimitive(
  state: ModelerState,
  name: PrimitiveName,
  values: PrimitiveValues,
  destination: 'merge' | 'layer',
): number {
  const layer = (destination === 'layer' ? state.firstEmptyLayer() : null) ?? state.activeLayer;
  state.execute(new AddPrimitiveCommand(state, PRIMITIVES[name].build(values), layer, `Create ${PRIMITIVES[name].label}`));
  return layer;
}
