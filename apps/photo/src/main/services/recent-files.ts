import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FileKind, RecentFile } from '../../shared/ipc';
import { readJsonFile, writeJsonAtomic } from './fs-utils';
import type { Logger } from './logger';

const MAX_RECENT = 15;

const RecentSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(
    z.object({
      path: z.string().min(1).max(4096),
      kind: z.enum(['project', 'image']),
      openedAt: z.iso.datetime({ offset: true }),
    }),
  ),
});
type Item = z.infer<typeof RecentSchema>['items'][number];

export class RecentFiles {
  private items: Item[] = [];

  constructor(
    private readonly file: string,
    private readonly platform: NodeJS.Platform,
    private readonly logger: Logger,
  ) {}

  private key(target: string): string {
    const resolved = path.resolve(target);
    return this.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  async init(): Promise<void> {
    const read = await readJsonFile(this.file);
    if (read.kind !== 'ok') return;
    const parsed = RecentSchema.safeParse(read.value);
    if (parsed.success) this.items = parsed.data.items.filter((item) => path.isAbsolute(item.path));
    else this.logger.warn('recent', 'Ignoring invalid recent files list');
  }

  has(target: string): boolean {
    const key = this.key(target);
    return this.items.some((item) => this.key(item.path) === key);
  }

  async add(target: string, kind: FileKind): Promise<void> {
    const key = this.key(target);
    this.items = [
      { path: target, kind, openedAt: new Date().toISOString() },
      ...this.items.filter((item) => this.key(item.path) !== key),
    ].slice(0, MAX_RECENT);
    await this.save();
  }

  async remove(target: string): Promise<void> {
    const key = this.key(target);
    this.items = this.items.filter((item) => this.key(item.path) !== key);
    await this.save();
  }

  async list(): Promise<RecentFile[]> {
    return Promise.all(
      this.items.map(async (item) => ({
        ...item,
        name: path.basename(item.path),
        exists: await stat(item.path).then(
          (info) => info.isFile(),
          () => false,
        ),
      })),
    );
  }

  private async save(): Promise<void> {
    try {
      await writeJsonAtomic(this.file, { schemaVersion: 1, items: this.items });
    } catch (error) {
      this.logger.warn('recent', 'Could not save recent files', error);
    }
  }
}
