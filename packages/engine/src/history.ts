import type { PhotoDocument } from './document';

/** A reversible change. Commands are pushed after they have been applied. */
export interface Command {
  readonly label: string;
  /** Approximate memory held by the command, used to bound history size. */
  readonly bytes: number;
  undo(doc: PhotoDocument): void;
  redo(doc: PhotoDocument): void;
  /**
   * Commands with the same key pushed in quick succession are merged, so that
   * e.g. dragging an opacity slider produces a single undo step.
   */
  readonly mergeKey?: string;
  merge?(next: Command): Command;
}

export interface HistoryOptions {
  maxEntries?: number;
  maxBytes?: number;
  /** Window in which commands with equal merge keys are combined. */
  mergeWindowMs?: number;
  now?: () => number;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Increments on every change; compare to detect unsaved changes. */
  version: number;
}

/**
 * Linear undo/redo stack with memory and length limits. The oldest entries
 * are discarded first when a limit is exceeded.
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private lastPushAt = 0;
  private versionCounter = 0;
  private readonly listeners = new Set<(state: HistoryState) => void>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly doc: PhotoDocument,
    options: HistoryOptions = {},
  ) {
    this.maxEntries = options.maxEntries ?? 200;
    this.maxBytes = options.maxBytes ?? 1024 * 1024 * 1024;
    this.mergeWindowMs = options.mergeWindowMs ?? 800;
    this.now = options.now ?? (() => Date.now());
  }

  onChange(listener: (state: HistoryState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get state(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      version: this.versionCounter,
    };
  }

  get version(): number {
    return this.versionCounter;
  }

  get totalBytes(): number {
    return [...this.undoStack, ...this.redoStack].reduce((sum, command) => sum + command.bytes, 0);
  }

  private notify(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }

  /** Records a command that has already been applied to the document. */
  push(command: Command): void {
    const now = this.now();
    const top = this.undoStack.at(-1);
    this.redoStack = [];
    if (
      top?.mergeKey !== undefined &&
      top.mergeKey === command.mergeKey &&
      top.merge &&
      now - this.lastPushAt <= this.mergeWindowMs
    ) {
      this.undoStack[this.undoStack.length - 1] = top.merge(command);
    } else {
      this.undoStack.push(command);
    }
    this.lastPushAt = now;
    this.versionCounter++;
    this.trim();
    this.notify();
  }

  /** Applies a command and records it. */
  execute(command: Command): void {
    command.redo(this.doc);
    this.push(command);
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo(this.doc);
    this.redoStack.push(command);
    this.lastPushAt = 0;
    this.versionCounter++;
    this.notify();
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.redo(this.doc);
    this.undoStack.push(command);
    this.lastPushAt = 0;
    this.versionCounter++;
    this.notify();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private trim(): void {
    while (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    let bytes = this.totalBytes;
    while (bytes > this.maxBytes && this.undoStack.length > 1) {
      bytes -= this.undoStack.shift()!.bytes;
    }
  }
}
