import { describe, expect, it } from 'vitest';
import { Stroke, dabCoverage } from './brush';
import { History } from './history';
import {
  addLayer,
  clearSelected,
  createDocument,
  deleteLayer,
  deselect,
  duplicateLayer,
  fill,
  flatten,
  flipDocument,
  invertSelection,
  mergeDown,
  moveLayer,
  sampleColor,
  select,
  selectAll,
  setLayerProps,
  translate,
} from './operations';
import { Selection } from './selection';

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

function setup(width = 32, height = 32) {
  const doc = createDocument(width, height, 'white');
  const history = new History(doc);
  return { doc, history };
}

describe('brush strokes', () => {
  it('produces a hard round dab with an anti-aliased edge', () => {
    expect(dabCoverage(0, 10, 1)).toBe(1);
    expect(dabCoverage(10, 10, 1)).toBe(0.5);
    expect(dabCoverage(11, 10, 1)).toBe(0);
    expect(dabCoverage(8, 10, 0)).toBeLessThan(0.2);
  });

  it('never exceeds the stroke opacity where the stroke overlaps itself', () => {
    const { doc } = setup();
    const stroke = new Stroke(
      doc,
      doc.activeLayerId,
      'paint',
      { r: 0, g: 0, b: 0, a: 255 },
      { size: 8, hardness: 1, opacity: 0.5, spacing: 0.05 },
    );
    stroke.addPoint(10, 16);
    stroke.addPoint(20, 16);
    stroke.addPoint(10, 16);
    const p = doc.activeLayer.raster.getPixel(15, 16);
    // 50% coverage of black over white, never darker despite three passes.
    expect(p).toEqual({ r: 127, g: 127, b: 127, a: 255 });
  });

  it('records an exact undo patch', () => {
    const { doc, history } = setup();
    const before = doc.activeLayer.raster.data.slice();
    const stroke = new Stroke(doc, doc.activeLayerId, 'paint', RED, {
      size: 6,
      hardness: 0.5,
      opacity: 1,
      spacing: 0.1,
    });
    stroke.addPoint(2, 2);
    stroke.addPoint(30, 30);
    history.push(stroke.end()!);
    const after = doc.activeLayer.raster.data.slice();
    expect(after).not.toEqual(before);
    history.undo();
    expect(doc.activeLayer.raster.data).toEqual(before);
    history.redo();
    expect(doc.activeLayer.raster.data).toEqual(after);
  });

  it('erases to transparency and respects the selection', () => {
    const { doc } = setup();
    doc.setSelection(Selection.rect(32, 32, { x: 0, y: 0, width: 16, height: 32 }));
    const stroke = new Stroke(doc, doc.activeLayerId, 'erase', RED, {
      size: 40,
      hardness: 1,
      opacity: 1,
      spacing: 0.1,
    });
    stroke.addPoint(16, 16);
    expect(doc.activeLayer.raster.getPixel(5, 16).a).toBe(0);
    expect(doc.activeLayer.raster.getPixel(25, 16).a).toBe(255);
  });

  it('returns no command for a stroke entirely outside the canvas', () => {
    const { doc } = setup();
    const stroke = new Stroke(doc, doc.activeLayerId, 'paint', RED, {
      size: 4,
      hardness: 1,
      opacity: 1,
      spacing: 0.1,
    });
    stroke.addPoint(-50, -50);
    expect(stroke.end()).toBeNull();
  });
});

describe('layers', () => {
  it('adds, duplicates, reorders and deletes layers with undo', () => {
    const { doc, history } = setup();
    history.push(addLayer(doc));
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1']);
    expect(doc.activeLayer.name).toBe('Layer 1');
    history.push(duplicateLayer(doc, doc.activeLayerId));
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1', 'Layer 1 copy']);
    history.push(moveLayer(doc, doc.activeLayerId, 'down')!);
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1 copy', 'Layer 1']);
    expect(moveLayer(doc, doc.layers[0]!.id, 'down')).toBeNull();
    history.push(deleteLayer(doc, doc.layers[1]!.id)!);
    expect(doc.layers.map((l) => l.name)).toEqual(['Background', 'Layer 1']);

    history.undo();
    history.undo();
    history.undo();
    history.undo();
    expect(doc.layers.map((l) => l.name)).toEqual(['Background']);
    expect(doc.activeLayer.name).toBe('Background');
  });

  it('refuses to delete the last layer', () => {
    const { doc } = setup();
    expect(deleteLayer(doc, doc.activeLayerId)).toBeNull();
  });

  it('merges slider changes into one undo step', () => {
    let now = 0;
    const doc = createDocument(4, 4);
    const history = new History(doc, { now: () => now });
    for (const opacity of [0.9, 0.8, 0.5]) {
      history.push(setLayerProps(doc, doc.activeLayerId, { opacity })!);
      now += 100;
    }
    expect(doc.activeLayer.opacity).toBe(0.5);
    history.undo();
    expect(doc.activeLayer.opacity).toBe(1);
    expect(history.state.canUndo).toBe(false);
  });

  it('merges a layer down using its blend mode and opacity', () => {
    const { doc, history } = setup(2, 1);
    history.push(addLayer(doc));
    doc.activeLayer.raster.fill({ r: 0, g: 0, b: 0, a: 255 });
    history.push(setLayerProps(doc, doc.activeLayerId, { opacity: 0.5 })!);
    const expected = flatten(doc);
    history.push(mergeDown(doc, doc.activeLayerId)!);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]!.raster.data).toEqual(expected);
    history.undo();
    expect(doc.layers).toHaveLength(2);
  });

  it('hides invisible layers from the composite', () => {
    const { doc, history } = setup(1, 1);
    history.push(addLayer(doc));
    doc.activeLayer.raster.fill(RED);
    expect([...flatten(doc)]).toEqual([255, 0, 0, 255]);
    history.push(setLayerProps(doc, doc.activeLayerId, { visible: false })!);
    expect([...flatten(doc)]).toEqual([255, 255, 255, 255]);
  });
});

describe('selection operations', () => {
  it('combines, inverts and clears selections', () => {
    const { doc, history } = setup(10, 10);
    history.push(select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 5, height: 10 } })!);
    history.push(select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 10, height: 2 } }, 'add')!);
    expect(doc.selection!.coverage(8, 1)).toBe(255);
    history.push(
      select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 2, height: 2 } }, 'subtract')!,
    );
    expect(doc.selection!.coverage(1, 1)).toBe(0);
    history.push(invertSelection(doc)!);
    expect(doc.selection!.coverage(1, 1)).toBe(255);
    expect(doc.selection!.coverage(3, 5)).toBe(0);
    history.push(deselect(doc)!);
    expect(doc.selection).toBeNull();
    expect(deselect(doc)).toBeNull();
    history.undo();
    expect(doc.selection).not.toBeNull();
  });

  it('fills and clears only the selected area', () => {
    const { doc, history } = setup(4, 4);
    history.push(select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 2, height: 4 } })!);
    history.push(fill(doc, doc.activeLayerId, BLUE)!);
    expect(doc.activeLayer.raster.getPixel(0, 0)).toEqual({ ...BLUE });
    expect(doc.activeLayer.raster.getPixel(3, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    history.push(clearSelected(doc, doc.activeLayerId)!);
    expect(doc.activeLayer.raster.getPixel(0, 0).a).toBe(0);
    history.push(selectAll(doc)!);
    expect(doc.selection!.bounds()).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it('anti-aliases elliptical selections and outlines them', () => {
    const ellipse = Selection.ellipse(20, 20, { x: 0, y: 0, width: 20, height: 20 });
    expect(ellipse.coverage(10, 10)).toBe(255);
    expect(ellipse.coverage(0, 0)).toBe(0);
    const edge = ellipse.coverage(10, 0);
    expect(edge).toBeGreaterThan(0);
    expect(Selection.rect(10, 10, { x: 2, y: 2, width: 3, height: 3 }).outline()).toEqual(
      new Float32Array([2, 2, 5, 2, 2, 5, 5, 5, 2, 2, 2, 5, 5, 2, 5, 5]),
    );
  });
});

describe('transformations', () => {
  it('moves the whole layer content', () => {
    const { doc, history } = setup(6, 6);
    history.push(addLayer(doc));
    doc.activeLayer.raster.fill(RED, { x: 0, y: 0, width: 2, height: 2 });
    history.push(translate(doc, doc.activeLayerId, 3, 1)!);
    expect(doc.activeLayer.raster.getPixel(0, 0).a).toBe(0);
    expect(doc.activeLayer.raster.getPixel(3, 1)).toEqual(RED);
    expect(doc.activeLayer.raster.getPixel(4, 2)).toEqual(RED);
    history.undo();
    expect(doc.activeLayer.raster.getPixel(0, 0)).toEqual(RED);
  });

  it('moves only selected pixels and the selection with them', () => {
    const { doc, history } = setup(6, 6);
    history.push(addLayer(doc));
    doc.activeLayer.raster.fill(RED);
    history.push(select(doc, { type: 'rect', rect: { x: 0, y: 0, width: 2, height: 2 } })!);
    history.push(translate(doc, doc.activeLayerId, 4, 0)!);
    expect(doc.activeLayer.raster.getPixel(0, 0).a).toBe(0);
    expect(doc.activeLayer.raster.getPixel(2, 0)).toEqual(RED);
    expect(doc.selection!.bounds()).toEqual({ x: 4, y: 0, width: 2, height: 2 });
  });

  it('flips all layers', () => {
    const { doc, history } = setup(3, 1);
    doc.activeLayer.raster.fill(RED, { x: 0, y: 0, width: 1, height: 1 });
    history.push(flipDocument(doc, true));
    expect(doc.activeLayer.raster.getPixel(2, 0)).toEqual(RED);
    expect(doc.activeLayer.raster.getPixel(0, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('samples the active layer or the merged image', () => {
    const { doc, history } = setup(2, 2);
    history.push(addLayer(doc));
    doc.activeLayer.raster.fill({ r: 0, g: 0, b: 0, a: 128 });
    expect(sampleColor(doc, 0, 0, false)).toEqual({ r: 0, g: 0, b: 0, a: 128 });
    expect(sampleColor(doc, 0, 0, true)).toEqual({ r: 127, g: 127, b: 127, a: 255 });
    expect(sampleColor(doc, 5, 5, true)).toBeNull();
  });
});

describe('history limits', () => {
  it('drops the oldest steps beyond the entry limit and clears redo on new work', () => {
    const doc = createDocument(2, 2);
    const history = new History(doc, { maxEntries: 2 });
    history.push(addLayer(doc));
    history.push(addLayer(doc));
    history.push(addLayer(doc));
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
    expect(history.state.canRedo).toBe(true);
    history.push(addLayer(doc));
    expect(history.state.canRedo).toBe(false);
  });
});
