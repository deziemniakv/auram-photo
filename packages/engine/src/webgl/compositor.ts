import { blendModeIndex } from '../blend';
import type { DocumentChange, PhotoDocument } from '../document';
import type { Rect } from '../geometry';
import {
  CLEAR_FRAGMENT,
  COMPOSITE_FRAGMENT,
  DISPLAY_FRAGMENT,
  FULLSCREEN_VERTEX,
  RESOLVE_FRAGMENT,
} from './shaders';

/** Maps document pixels to canvas CSS pixels: `screen = doc * scale + offset`. */
export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface DisplayStyle {
  checkerA: [number, number, number];
  checkerB: [number, number, number];
  background: [number, number, number];
  /** Checkerboard square size in CSS pixels. */
  checkerSize: number;
}

export class WebGLUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGLUnavailableError';
  }
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

/**
 * GPU compositor for a PhotoDocument. Layer pixels live in RGBA8 textures that
 * are updated incrementally from document change events; the stack is
 * composited into a half-float (or RGBA8 fallback) accumulation buffer, then
 * drawn into the canvas at the current view transform.
 */
export class Compositor {
  private gl!: WebGL2RenderingContext;
  private programs!: { composite: Program; clear: Program; display: Program; resolve: Program };
  private layerTextures = new Map<string, WebGLTexture>();
  private targets: [Target, Target] | null = null;
  private resolveTarget: Target | null = null;
  private result: Target | null = null;
  private dirty = true;
  private mipmapsValid = false;
  private floatTargets = false;
  private lost = false;
  private readonly offsets = new Map<string, { x: number; y: number }>();
  private readonly unsubscribe: () => void;
  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = () => {
    this.lost = false;
    this.initialise();
  };

  /** Largest supported document edge on this GPU. */
  maxTextureSize = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly doc: PhotoDocument,
  ) {
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.initialise();
    this.unsubscribe = doc.on((change) => this.handleChange(change));
  }

  private initialise(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new WebGLUnavailableError('WebGL 2 is not available on this system.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (this.doc.width > this.maxTextureSize || this.doc.height > this.maxTextureSize) {
      throw new WebGLUnavailableError(
        `This image (${this.doc.width}×${this.doc.height}) exceeds the GPU limit of ${this.maxTextureSize} pixels per side.`,
      );
    }
    this.floatTargets = gl.getExtension('EXT_color_buffer_float') !== null;
    this.programs = {
      composite: this.createProgram(COMPOSITE_FRAGMENT, [
        'u_backdrop',
        'u_layer',
        'u_opacity',
        'u_mode',
        'u_offset',
        'u_size',
      ]),
      clear: this.createProgram(CLEAR_FRAGMENT, []),
      display: this.createProgram(DISPLAY_FRAGMENT, [
        'u_image',
        'u_docSize',
        'u_canvasSize',
        'u_scale',
        'u_offset',
        'u_checkerSize',
        'u_checkerA',
        'u_checkerB',
        'u_background',
        'u_smooth',
      ]),
      resolve: this.createProgram(RESOLVE_FRAGMENT, ['u_image']),
    };
    gl.bindVertexArray(gl.createVertexArray());
    this.layerTextures.clear();
    this.targets = [this.createTarget(true), this.createTarget(true)];
    this.resolveTarget = null;
    this.syncLayers();
    this.dirty = true;
  }

  private createProgram(fragmentSource: string, uniformNames: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new WebGLUnavailableError(
          `Shader compilation failed: ${gl.getShaderInfoLog(shader) ?? ''}`,
        );
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, FULLSCREEN_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new WebGLUnavailableError(
        `Shader linking failed: ${gl.getProgramInfoLog(program) ?? ''}`,
      );
    }
    return {
      program,
      uniforms: new Map(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)])),
    };
  }

  private createTarget(mipmapped: boolean, format: 'accumulate' | 'rgba8' = 'accumulate'): Target {
    const gl = this.gl;
    const { width, height } = this.doc;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const levels = mipmapped ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    const internal = format === 'accumulate' && this.floatTargets ? gl.RGBA16F : gl.RGBA8;
    gl.texStorage2D(gl.TEXTURE_2D, levels, internal, width, height);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new WebGLUnavailableError('The GPU cannot render into the compositing buffer.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer };
  }

  /** Creates and deletes textures so they match the document's layers. */
  private syncLayers(): void {
    const gl = this.gl;
    const ids = new Set(this.doc.layers.map((layer) => layer.id));
    for (const [id, texture] of this.layerTextures) {
      if (!ids.has(id)) {
        gl.deleteTexture(texture);
        this.layerTextures.delete(id);
      }
    }
    for (const layer of this.doc.layers) {
      if (this.layerTextures.has(layer.id)) continue;
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.doc.width, this.doc.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.layerTextures.set(layer.id, texture);
      this.upload(layer.id, layer.raster.bounds);
    }
  }

  private upload(layerId: string, rect: Rect): void {
    const gl = this.gl;
    const texture = this.layerTextures.get(layerId);
    if (!texture || rect.width <= 0 || rect.height <= 0) return;
    const raster = this.doc.getLayer(layerId).raster;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, raster.width);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      raster.data,
    );
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  private handleChange(change: DocumentChange): void {
    if (this.lost) return;
    if (change.kind === 'pixels') this.upload(change.layerId, change.rect);
    if (change.kind === 'layers') this.syncLayers();
    if (change.kind !== 'selection' && change.kind !== 'active-layer') this.invalidate();
  }

  /** Forces recomposition on the next render. */
  invalidate(): void {
    this.dirty = true;
    this.mipmapsValid = false;
  }

  /** Temporarily draws a layer shifted by whole pixels (move tool preview). */
  setLayerOffset(layerId: string, x: number, y: number): void {
    if (x === 0 && y === 0) this.offsets.delete(layerId);
    else this.offsets.set(layerId, { x: Math.round(x), y: Math.round(y) });
    this.invalidate();
  }

  clearLayerOffsets(): void {
    if (this.offsets.size === 0) return;
    this.offsets.clear();
    this.invalidate();
  }

  private bindQuad(program: Program): void {
    this.gl.useProgram(program.program);
  }

  private composite(): Target {
    const gl = this.gl;
    const [a, b] = this.targets!;
    const { width, height } = this.doc;
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    this.bindQuad(this.programs.clear);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    let source = a;
    let destination = b;
    const p = this.programs.composite;
    this.bindQuad(p);
    gl.uniform1i(p.uniforms.get('u_backdrop')!, 0);
    gl.uniform1i(p.uniforms.get('u_layer')!, 1);
    gl.uniform2i(p.uniforms.get('u_size')!, width, height);
    for (const layer of this.doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const offset = this.offsets.get(layer.id) ?? { x: 0, y: 0 };
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.layerTextures.get(layer.id)!);
      gl.uniform1f(p.uniforms.get('u_opacity')!, layer.opacity);
      gl.uniform1i(p.uniforms.get('u_mode')!, blendModeIndex(layer.blendMode));
      gl.uniform2i(p.uniforms.get('u_offset')!, offset.x, offset.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [source, destination] = [destination, source];
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dirty = false;
    return source;
  }

  private ensureComposite(): Target {
    if (this.dirty || !this.result) this.result = this.composite();
    return this.result;
  }

  /**
   * Draws the document. `width`/`height` are the canvas size in CSS pixels and
   * `ratio` the device pixel ratio; the canvas backing store is resized to match.
   */
  render(
    view: ViewTransform,
    width: number,
    height: number,
    ratio: number,
    style: DisplayStyle,
  ): void {
    if (this.lost) return;
    const gl = this.gl;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const image = this.ensureComposite();
    const smooth = view.scale < 1;
    if (smooth && !this.mipmapsValid) {
      gl.bindTexture(gl.TEXTURE_2D, image.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.mipmapsValid = true;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    const p = this.programs.display;
    this.bindQuad(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    gl.uniform1i(p.uniforms.get('u_image')!, 0);
    gl.uniform2f(p.uniforms.get('u_docSize')!, this.doc.width, this.doc.height);
    gl.uniform2f(p.uniforms.get('u_canvasSize')!, pixelWidth, pixelHeight);
    gl.uniform1f(p.uniforms.get('u_scale')!, view.scale * ratio);
    gl.uniform2f(p.uniforms.get('u_offset')!, view.offsetX * ratio, view.offsetY * ratio);
    gl.uniform1f(p.uniforms.get('u_checkerSize')!, style.checkerSize * ratio);
    gl.uniform3fv(p.uniforms.get('u_checkerA')!, style.checkerA);
    gl.uniform3fv(p.uniforms.get('u_checkerB')!, style.checkerB);
    gl.uniform3fv(p.uniforms.get('u_background')!, style.background);
    gl.uniform1i(p.uniforms.get('u_smooth')!, smooth ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** The composited image as straight-alpha RGBA8, top row first. */
  readComposite(): Uint8ClampedArray {
    const gl = this.gl;
    const image = this.ensureComposite();
    this.resolveTarget ??= this.createTarget(false, 'rgba8');
    const { width, height } = this.doc;
    gl.viewport(0, 0, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveTarget.framebuffer);
    const p = this.programs.resolve;
    this.bindQuad(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    gl.uniform1i(p.uniforms.get('u_image')!, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  get usesFloatAccumulation(): boolean {
    return this.floatTargets;
  }

  dispose(): void {
    this.unsubscribe();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (this.lost) return;
    const gl = this.gl;
    for (const texture of this.layerTextures.values()) gl.deleteTexture(texture);
    for (const target of [...(this.targets ?? []), this.resolveTarget]) {
      if (!target) continue;
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    this.layerTextures.clear();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
