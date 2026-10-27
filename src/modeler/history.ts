/** A reversible edit. `redo` must be idempotent with respect to the state `undo` restores. */
export interface Command {
  readonly label: string;
  redo(): void;
  undo(): void;
  /**
   * True for edits that are not tied to one layer: the palette and images, which every layer shares, and edits that choose
   * which layer is active themselves (paste, boolean). Every other edit belongs to the layer it was made on, and undoing or
   * redoing it switches back to that layer first.
   */
  readonly projectWide?: boolean;
}

interface Entry {
  cmd: Command;
  /** The layer the edit was made on, or undefined for project-wide edits. */
  layer: number | undefined;
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private _revision = 0;

  constructor(private readonly limit = 200) {}

  /** Changes whenever the model's edit history does (record, undo, redo, clear), and never repeats: compare it to know if there is unsaved work. */
  get revision(): number {
    return this._revision;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.cmd.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.cmd.label ?? null;
  }

  /** The layer the next undo belongs to, if it belongs to one. */
  get undoLayer(): number | undefined {
    return this.undoStack.at(-1)?.layer;
  }

  /** The layer the next redo belongs to, if it belongs to one. */
  get redoLayer(): number | undefined {
    return this.redoStack.at(-1)?.layer;
  }

  /** Record a command whose effect has already been applied, and the layer it was made on (omit it for project-wide edits). */
  record(cmd: Command, layer?: number): void {
    this.undoStack.push({ cmd, layer: cmd.projectWide ? undefined : layer });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._revision++;
  }

  undo(): Command | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    entry.cmd.undo();
    this.redoStack.push(entry);
    this._revision++;
    return entry.cmd;
  }

  redo(): Command | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    entry.cmd.redo();
    this.undoStack.push(entry);
    this._revision++;
    return entry.cmd;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._revision++;
  }
}
