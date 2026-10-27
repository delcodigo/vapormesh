/** Keyframed channel (position, rotation, intensity, ...). Linear for now; spline/TCB later. */
export interface Key {
  time: number; // seconds
  value: number;
}

export class Envelope {
  keys: Key[] = [];

  set(time: number, value: number): void {
    const i = this.keys.findIndex((k) => k.time >= time);
    if (i >= 0 && this.keys[i]!.time === time) this.keys[i]!.value = value;
    else if (i >= 0) this.keys.splice(i, 0, { time, value });
    else this.keys.push({ time, value });
  }

  evaluate(time: number, fallback = 0): number {
    const { keys } = this;
    if (keys.length === 0) return fallback;
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    if (time <= first.time) return first.value;
    if (time >= last.time) return last.value;
    const i = keys.findIndex((k) => k.time > time);
    const a = keys[i - 1]!;
    const b = keys[i]!;
    return a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time);
  }
}
