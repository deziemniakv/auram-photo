import { History, type PhotoDocument } from '@auram/photo-engine';
import type { ViewTransform } from '@auram/photo-engine/webgl';

export interface FileInfo {
  /** Saved project path; null for new documents and imported images. */
  projectPath: string | null;
  name: string;
  projectId: string;
  createdAt: string;
}

/** One open document with its history and view. Lives outside React. */
export class EditorSession {
  readonly id = crypto.randomUUID();
  readonly history: History;
  savedVersion = 0;
  view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  viewFitted = false;

  constructor(
    readonly doc: PhotoDocument,
    public file: FileInfo,
    /** True when the document has never been saved as a project. */
    public unsavedNew = false,
  ) {
    this.history = new History(doc);
  }

  get edited(): boolean {
    return this.unsavedNew || this.history.version !== this.savedVersion;
  }

  markSaved(): void {
    this.savedVersion = this.history.version;
    this.unsavedNew = false;
  }
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || name;
}
