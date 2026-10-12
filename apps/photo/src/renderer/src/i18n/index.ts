import type { Language } from '../../../shared/ipc';
import { useEditor } from '../editor/store';
import { en, type Dictionary } from './en';
import { pl } from './pl';

export const dictionaries: Record<Language, Dictionary> = { en, pl };
export type { Dictionary };

export function useT(): Dictionary {
  return dictionaries[useEditor((s) => s.info?.language ?? 'en')];
}

/** For code outside React components. */
export function currentT(): Dictionary {
  return dictionaries[useEditor.getState().info?.language ?? 'en'];
}
