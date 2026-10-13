import type { Dictionary } from '../i18n';
import {
  closeDocument,
  cropToSelection,
  edit,
  openWithDialog,
  redo,
  resetColors,
  rotate,
  save,
  swapColors,
  undo,
  view,
} from './actions';
import {
  applyCrop,
  beginTransform,
  cancelTransform,
  commitTransform,
  currentCrop,
  setCropRect,
} from './geometry';
import { useEditor, type EditorState, type ToolId } from './store';
import { call } from '../lib/api';
import { nudgeTransform } from '../tools/geometry-tools';

export interface KeyBinding {
  /** `KeyboardEvent.key`, lower-cased. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface AppCommand {
  id: string;
  label: (t: Dictionary, state: EditorState) => string;
  keys?: KeyBinding[];
  run: () => void;
  enabled?: (state: EditorState) => boolean;
}

/** A document is open and can be edited (nothing is processing or being transformed). */
const hasDoc = (s: EditorState) => s.session !== null && s.busy === null && !s.transforming;
const viewable = (s: EditorState) => s.session !== null;
const hasSelection = (s: EditorState) => hasDoc(s) && s.session!.doc.selection !== null;
const multiLayer = (s: EditorState) => hasDoc(s) && s.session!.doc.layers.length > 1;
const notBottom = (s: EditorState) =>
  hasDoc(s) && s.session!.doc.indexOf(s.session!.doc.activeLayerId) > 0;
const notTop = (s: EditorState) =>
  hasDoc(s) &&
  s.session!.doc.indexOf(s.session!.doc.activeLayerId) < s.session!.doc.layers.length - 1;
const open = (dialog: 'new' | 'export' | 'about' | 'image-size' | 'canvas-size') => () =>
  useEditor.setState({ dialog: { type: dialog } });

export const COMMANDS = {
  new: {
    id: 'new',
    label: (t) => t.menu.new,
    keys: [{ key: 'n', mod: true }],
    run: open('new'),
    enabled: (s) => s.busy === null,
  },
  open: {
    id: 'open',
    label: (t) => t.menu.open,
    keys: [{ key: 'o', mod: true }],
    run: () => void openWithDialog(),
    enabled: (s) => s.busy === null,
  },
  save: {
    id: 'save',
    label: (t) => t.menu.save,
    keys: [{ key: 's', mod: true }],
    run: () => void save(false),
    enabled: hasDoc,
  },
  saveAs: {
    id: 'saveAs',
    label: (t) => t.menu.saveAs,
    keys: [{ key: 's', mod: true, shift: true }],
    run: () => void save(true),
    enabled: hasDoc,
  },
  export: {
    id: 'export',
    label: (t) => t.menu.export,
    keys: [{ key: 'e', mod: true, shift: true }],
    run: open('export'),
    enabled: hasDoc,
  },
  close: {
    id: 'close',
    label: (t) => t.menu.closeDocument,
    keys: [{ key: 'w', mod: true }],
    run: () => void closeDocument(),
    enabled: hasDoc,
  },

  undo: {
    id: 'undo',
    label: (t, s) =>
      t.menu.undo(s.history.undoLabel ? (t.history[s.history.undoLabel] ?? null) : null),
    keys: [{ key: 'z', mod: true }],
    run: undo,
    enabled: (s) => hasDoc(s) && s.history.canUndo,
  },
  redo: {
    id: 'redo',
    label: (t, s) =>
      t.menu.redo(s.history.redoLabel ? (t.history[s.history.redoLabel] ?? null) : null),
    keys: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
    run: redo,
    enabled: (s) => hasDoc(s) && s.history.canRedo,
  },
  fill: {
    id: 'fill',
    label: (t) => t.menu.fill,
    keys: [{ key: 'backspace', alt: true }],
    run: edit.fill,
    enabled: hasDoc,
  },
  clear: {
    id: 'clear',
    label: (t) => t.menu.clear,
    keys: [{ key: 'delete' }, { key: 'backspace' }],
    run: edit.clear,
    enabled: hasSelection,
  },

  freeTransform: {
    id: 'freeTransform',
    label: (t) => t.menu.freeTransform,
    keys: [{ key: 't', mod: true }],
    run: beginTransform,
    enabled: hasDoc,
  },

  imageSize: {
    id: 'imageSize',
    label: (t) => t.menu.imageSize,
    keys: [{ key: 'i', mod: true, alt: true }],
    run: open('image-size'),
    enabled: hasDoc,
  },
  canvasSize: {
    id: 'canvasSize',
    label: (t) => t.menu.canvasSize,
    keys: [{ key: 'c', mod: true, alt: true }],
    run: open('canvas-size'),
    enabled: hasDoc,
  },
  cropToSelection: {
    id: 'cropToSelection',
    label: (t) => t.menu.cropToSelection,
    run: cropToSelection,
    enabled: hasSelection,
  },
  rotateClockwise: {
    id: 'rotateClockwise',
    label: (t) => t.menu.rotateClockwise,
    run: () => void rotate(1),
    enabled: hasDoc,
  },
  rotateCounterClockwise: {
    id: 'rotateCounterClockwise',
    label: (t) => t.menu.rotateCounterClockwise,
    run: () => void rotate(3),
    enabled: hasDoc,
  },
  rotate180: {
    id: 'rotate180',
    label: (t) => t.menu.rotate180,
    run: () => void rotate(2),
    enabled: hasDoc,
  },
  flipHorizontal: {
    id: 'flipHorizontal',
    label: (t) => t.menu.flipHorizontal,
    run: edit.flipHorizontal,
    enabled: hasDoc,
  },
  flipVertical: {
    id: 'flipVertical',
    label: (t) => t.menu.flipVertical,
    run: edit.flipVertical,
    enabled: hasDoc,
  },

  newLayer: {
    id: 'newLayer',
    label: (t) => t.menu.newLayer,
    keys: [{ key: 'n', mod: true, shift: true }],
    run: edit.addLayer,
    enabled: hasDoc,
  },
  duplicateLayer: {
    id: 'duplicateLayer',
    label: (t) => t.menu.duplicateLayer,
    keys: [{ key: 'j', mod: true }],
    run: edit.duplicateLayer,
    enabled: hasDoc,
  },
  deleteLayer: {
    id: 'deleteLayer',
    label: (t) => t.menu.deleteLayer,
    run: edit.deleteLayer,
    enabled: multiLayer,
  },
  mergeDown: {
    id: 'mergeDown',
    label: (t) => t.menu.mergeDown,
    keys: [{ key: 'e', mod: true }],
    run: edit.mergeDown,
    enabled: notBottom,
  },
  moveLayerUp: {
    id: 'moveLayerUp',
    label: (t) => t.menu.moveLayerUp,
    keys: [{ key: ']', mod: true }],
    run: edit.moveLayerUp,
    enabled: notTop,
  },
  moveLayerDown: {
    id: 'moveLayerDown',
    label: (t) => t.menu.moveLayerDown,
    keys: [{ key: '[', mod: true }],
    run: edit.moveLayerDown,
    enabled: notBottom,
  },

  selectAll: {
    id: 'selectAll',
    label: (t) => t.menu.selectAll,
    keys: [{ key: 'a', mod: true }],
    run: edit.selectAll,
    enabled: hasDoc,
  },
  deselect: {
    id: 'deselect',
    label: (t) => t.menu.deselect,
    keys: [{ key: 'd', mod: true }],
    run: edit.deselect,
    enabled: hasSelection,
  },
  invertSelection: {
    id: 'invertSelection',
    label: (t) => t.menu.invertSelection,
    keys: [{ key: 'i', mod: true, shift: true }],
    run: edit.invertSelection,
    enabled: hasSelection,
  },

  zoomIn: {
    id: 'zoomIn',
    label: (t) => t.menu.zoomIn,
    keys: [
      { key: '=', mod: true },
      { key: '+', mod: true },
    ],
    run: view.zoomIn,
    enabled: viewable,
  },
  zoomOut: {
    id: 'zoomOut',
    label: (t) => t.menu.zoomOut,
    keys: [{ key: '-', mod: true }],
    run: view.zoomOut,
    enabled: viewable,
  },
  fit: {
    id: 'fit',
    label: (t) => t.menu.fitToWindow,
    keys: [{ key: '0', mod: true }],
    run: view.fit,
    enabled: viewable,
  },
  actualSize: {
    id: 'actualSize',
    label: (t) => t.menu.actualSize,
    keys: [{ key: '1', mod: true }],
    run: view.actualSize,
    enabled: viewable,
  },

  openLogs: {
    id: 'openLogs',
    label: (t) => t.menu.openLogs,
    run: () => void call((api) => api.app.openLogs()).catch(() => {}),
  },
  about: { id: 'about', label: (t) => t.menu.about, run: open('about') },
} satisfies Record<string, AppCommand>;

export type CommandId = keyof typeof COMMANDS;

export const MENUS: Array<{
  id: string;
  label: (t: Dictionary) => string;
  items: Array<CommandId | '-'>;
}> = [
  {
    id: 'file',
    label: (t) => t.menu.file,
    items: ['new', 'open', '-', 'save', 'saveAs', 'export', '-', 'close'],
  },
  {
    id: 'edit',
    label: (t) => t.menu.edit,
    items: ['undo', 'redo', '-', 'fill', 'clear', '-', 'freeTransform'],
  },
  {
    id: 'image',
    label: (t) => t.menu.image,
    items: [
      'imageSize',
      'canvasSize',
      '-',
      'cropToSelection',
      '-',
      'rotateClockwise',
      'rotateCounterClockwise',
      'rotate180',
      '-',
      'flipHorizontal',
      'flipVertical',
    ],
  },
  {
    id: 'layer',
    label: (t) => t.menu.layer,
    items: [
      'newLayer',
      'duplicateLayer',
      'deleteLayer',
      '-',
      'mergeDown',
      '-',
      'moveLayerUp',
      'moveLayerDown',
    ],
  },
  {
    id: 'select',
    label: (t) => t.menu.select,
    items: ['selectAll', 'deselect', 'invertSelection'],
  },
  { id: 'view', label: (t) => t.menu.view, items: ['zoomIn', 'zoomOut', '-', 'fit', 'actualSize'] },
  { id: 'help', label: (t) => t.menu.help, items: ['openLogs', '-', 'about'] },
];

export const TOOL_KEYS: Record<string, ToolId> = {
  v: 'move',
  c: 'crop',
  b: 'brush',
  e: 'eraser',
  i: 'eyedropper',
  h: 'hand',
  z: 'zoom',
};

const isMac = () => navigator.platform.toLowerCase().includes('mac');

export function formatBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(isMac() ? '⌘' : 'Ctrl');
  if (binding.alt) parts.push(isMac() ? '⌥' : 'Alt');
  if (binding.shift) parts.push('Shift');
  const names: Record<string, string> = {
    delete: 'Del',
    backspace: 'Backspace',
    enter: 'Enter',
    escape: 'Esc',
    '=': '+',
  };
  parts.push(names[binding.key] ?? binding.key.toUpperCase());
  return parts.join(isMac() ? '' : '+');
}

function matches(event: KeyboardEvent, binding: KeyBinding): boolean {
  const mod = isMac() ? event.metaKey : event.ctrlKey;
  return (
    event.key.toLowerCase() === binding.key &&
    mod === Boolean(binding.mod) &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt)
  );
}

/** Handles a keyboard shortcut. Returns true when the event was used. */
export function handleShortcut(event: KeyboardEvent): boolean {
  const state = useEditor.getState();
  if (state.dialog) return false;
  const plain = !(event.ctrlKey || event.metaKey || event.altKey);
  if (state.transforming && plain) {
    const step = event.shiftKey ? 10 : 1;
    const nudges: Record<string, [number, number]> = {
      arrowleft: [-step, 0],
      arrowright: [step, 0],
      arrowup: [0, -step],
      arrowdown: [0, step],
    };
    const key = event.key.toLowerCase();
    if (key === 'enter') void commitTransform();
    else if (key === 'escape') cancelTransform();
    else if (nudges[key]) {
      if (!state.busy) nudgeTransform(...nudges[key]);
    }
    // Tool and colour keys do nothing while transforming; Tab and the like still work.
    else return key.length === 1;
    return true;
  }
  if (state.tool === 'crop' && currentCrop() && plain && !state.busy) {
    if (event.key === 'Enter') {
      applyCrop();
      return true;
    }
    if (event.key === 'Escape') {
      setCropRect(null);
      return true;
    }
  }
  for (const command of Object.values(COMMANDS) as AppCommand[]) {
    if (!command.keys?.some((binding) => matches(event, binding))) continue;
    if (command.enabled && !command.enabled(state)) return true;
    command.run();
    return true;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || !state.session) return false;
  const key = event.key.toLowerCase();
  if (key === 'm') {
    useEditor.setState({
      tool: state.tool === 'marquee-rect' ? 'marquee-ellipse' : 'marquee-rect',
    });
    return true;
  }
  if (key === 'x') {
    swapColors();
    return true;
  }
  if (key === 'd') {
    resetColors();
    return true;
  }
  if (key === '[' || key === ']') {
    const which = state.tool === 'eraser' ? 'eraser' : 'brush';
    const current = state[which];
    const step = Math.max(1, Math.round(current.size * 0.1));
    const size = Math.min(1000, Math.max(1, current.size + (key === ']' ? step : -step)));
    useEditor.setState({ [which]: { ...current, size } } as Partial<EditorState>);
    return true;
  }
  const tool = TOOL_KEYS[key];
  if (tool) {
    useEditor.setState({ tool });
    return true;
  }
  return false;
}
