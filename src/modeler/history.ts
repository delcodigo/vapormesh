/** A reversible edit. `redo` must be idempotent with respect to the state `undo` restores. */
export interface Command {
  readonly label: string;
  redo(): void;
  undo(): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
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
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Record a command whose effect has already been applied. */
  record(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._revision++;
  }

  undo(): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    this._revision++;
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.redo();
    this.undoStack.push(cmd);
    this._revision++;
    return cmd;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._revision++;
  }
}
