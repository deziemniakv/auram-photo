import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { addLayer, createDocument, setLayerProps } from './operations';
import { ProjectFormatError, downscale, readProject, writeProject } from './project';

const info = {
  id: '0b6f1d2e-6a3c-4c1e-9f55-3c2c8f1b9a10',
  name: 'Poster',
  createdAt: '2026-10-01T10:00:00.000Z',
  appVersion: '0.1.0',
};

describe('project files', () => {
  it('round-trips layers losslessly, including semi-transparent pixels', () => {
    const doc = createDocument(7, 5, 'white');
    addLayer(doc);
    const data = doc.activeLayer.raster.data;
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
    setLayerProps(doc, doc.activeLayerId, {
      name: 'Ink',
      opacity: 0.4,
      blendMode: 'multiply',
      visible: false,
    });

    const bytes = writeProject(doc, info, new Date('2026-10-02T00:00:00Z'));
    const { doc: loaded, manifest } = readProject(bytes);

    expect(manifest).toMatchObject({
      format: 'auram.project',
      appId: 'auram.photo',
      name: 'Poster',
      modifiedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(loaded.width).toBe(7);
    expect(
      loaded.layers.map(({ id, name, opacity, blendMode, visible }) => ({
        id,
        name,
        opacity,
        blendMode,
        visible,
      })),
    ).toEqual(
      doc.layers.map(({ id, name, opacity, blendMode, visible }) => ({
        id,
        name,
        opacity,
        blendMode,
        visible,
      })),
    );
    expect(loaded.layers[1]!.raster.data).toEqual(doc.layers[1]!.raster.data);
    expect(loaded.activeLayerId).toBe(doc.activeLayerId);
  });

  it('includes a thumbnail the launcher can show', async () => {
    const { unzipSync } = await import('fflate');
    const entries = unzipSync(writeProject(createDocument(2000, 1000), info));
    expect(Object.keys(entries).sort()).toEqual(
      expect.arrayContaining(['manifest.json', 'document.json', 'thumbnail.png']),
    );
    const { decodePngToRgba } = await import('./project');
    const thumb = decodePngToRgba(entries['thumbnail.png']!);
    expect([thumb.width, thumb.height]).toEqual([512, 256]);
  });

  it('rejects broken or foreign projects with a clear error', () => {
    expect(() => readProject(new Uint8Array([1, 2, 3]))).toThrow(ProjectFormatError);

    const manifest = {
      format: 'auram.project',
      formatVersion: 1,
      id: info.id,
      name: 'Clip',
      appId: 'auram.video',
      createdAt: info.createdAt,
      modifiedAt: info.createdAt,
    };
    expect(() =>
      readProject(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })),
    ).toThrow(/another application/);

    const photoManifest = { ...manifest, appId: 'auram.photo' };
    expect(() =>
      readProject(zipSync({ 'manifest.json': strToU8(JSON.stringify(photoManifest)) })),
    ).toThrow(/document.json/);

    const doc = {
      format: 'auram.photo.document',
      formatVersion: 1,
      width: 2,
      height: 2,
      activeLayerId: 'a',
      layers: [{ id: 'a', name: 'A', visible: true, opacity: 1, blendMode: 'normal' }],
    };
    expect(() =>
      readProject(
        zipSync({
          'manifest.json': strToU8(JSON.stringify(photoManifest)),
          'document.json': strToU8(JSON.stringify(doc)),
        }),
      ),
    ).toThrow(/missing its image data/);
  });

  it('downscales with alpha-weighted averaging', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]);
    const out = downscale(pixels, 2, 1, 1);
    expect([...out.data]).toEqual([255, 0, 0, 128]);
  });
});
