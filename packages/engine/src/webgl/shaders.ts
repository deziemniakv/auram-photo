import { BLEND_MODES } from '../blend';

/** Full-screen triangle; no vertex buffers needed. */
export const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const modeIndex = (name: (typeof BLEND_MODES)[number]) => BLEND_MODES.indexOf(name);

/**
 * Composites one straight-alpha layer onto a premultiplied backdrop.
 * Mirrors FloatCanvas.composite / blendColors in ../blend.ts.
 */
export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_backdrop;
uniform sampler2D u_layer;
uniform float u_opacity;
uniform int u_mode;
uniform ivec2 u_offset;
uniform ivec2 u_size;
// Floating pixels of a free transform, drawn over this layer through u_floatInverse.
uniform bool u_hasFloat;
uniform sampler2D u_float;
uniform ivec2 u_floatSize;
uniform vec2 u_floatOrigin;
uniform mat3 u_floatInverse;
out vec4 outColor;

vec4 floatTexel(ivec2 q) {
  if (q.x < 0 || q.y < 0 || q.x >= u_floatSize.x || q.y >= u_floatSize.y) return vec4(0.0);
  vec4 c = texelFetch(u_float, q, 0);
  return vec4(c.rgb * c.a, c.a);
}

/** Premultiplied bilinear sample of the floating pixels at a document position. */
vec4 sampleFloat(vec2 docPos) {
  vec2 c = (u_floatInverse * vec3(docPos, 1.0)).xy - u_floatOrigin - 0.5;
  vec2 f = floor(c);
  vec2 t = c - f;
  ivec2 i = ivec2(f);
  return mix(
    mix(floatTexel(i), floatTexel(i + ivec2(1, 0)), t.x),
    mix(floatTexel(i + ivec2(0, 1)), floatTexel(i + ivec2(1, 1)), t.x),
    t.y
  );
}

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  if (mx <= mn) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
float hardLight(float cb, float cs) {
  return cs <= 0.5 ? cb * 2.0 * cs : cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0);
}
float dodge(float cb, float cs) {
  if (cb <= 0.0) return 0.0;
  if (cs >= 1.0) return 1.0;
  return min(1.0, cb / (1.0 - cs));
}
float burn(float cb, float cs) {
  if (cb >= 1.0) return 1.0;
  if (cs <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - cb) / cs);
}
float softLight(float cb, float cs) {
  if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}
vec3 blend(vec3 cb, vec3 cs) {
  switch (u_mode) {
    case ${modeIndex('multiply')}: return cb * cs;
    case ${modeIndex('screen')}: return cb + cs - cb * cs;
    case ${modeIndex('overlay')}: return vec3(hardLight(cs.r, cb.r), hardLight(cs.g, cb.g), hardLight(cs.b, cb.b));
    case ${modeIndex('darken')}: return min(cb, cs);
    case ${modeIndex('lighten')}: return max(cb, cs);
    case ${modeIndex('color-dodge')}: return vec3(dodge(cb.r, cs.r), dodge(cb.g, cs.g), dodge(cb.b, cs.b));
    case ${modeIndex('color-burn')}: return vec3(burn(cb.r, cs.r), burn(cb.g, cs.g), burn(cb.b, cs.b));
    case ${modeIndex('hard-light')}: return vec3(hardLight(cb.r, cs.r), hardLight(cb.g, cs.g), hardLight(cb.b, cs.b));
    case ${modeIndex('soft-light')}: return vec3(softLight(cb.r, cs.r), softLight(cb.g, cs.g), softLight(cb.b, cs.b));
    case ${modeIndex('difference')}: return abs(cb - cs);
    case ${modeIndex('exclusion')}: return cb + cs - 2.0 * cb * cs;
    case ${modeIndex('hue')}: return setLum(setSat(cs, sat(cb)), lum(cb));
    case ${modeIndex('saturation')}: return setLum(setSat(cb, sat(cs)), lum(cb));
    case ${modeIndex('color')}: return setLum(cs, lum(cb));
    case ${modeIndex('luminosity')}: return setLum(cb, lum(cs));
    default: return cs;
  }
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 b = texelFetch(u_backdrop, p, 0);
  ivec2 q = p - u_offset;
  vec4 s = (q.x < 0 || q.y < 0 || q.x >= u_size.x || q.y >= u_size.y) ? vec4(0.0) : texelFetch(u_layer, q, 0);
  if (u_hasFloat) {
    vec4 f = sampleFloat(vec2(p) + 0.5);
    vec4 o = f + vec4(s.rgb * s.a, s.a) * (1.0 - f.a);
    s = o.a > 0.0 ? vec4(o.rgb / o.a, o.a) : vec4(0.0);
  }
  float as = s.a * u_opacity;
  if (as <= 0.0) { outColor = b; return; }
  float ab = b.a;
  vec3 mixed = s.rgb;
  if (ab > 0.0 && u_mode != 0) {
    vec3 cb = b.rgb / ab;
    mixed = (1.0 - ab) * s.rgb + ab * clamp(blend(cb, s.rgb), 0.0, 1.0);
  }
  outColor = vec4(as * mixed + (1.0 - as) * b.rgb, as + ab * (1.0 - as));
}`;

/** Clears to transparent black. */
export const CLEAR_FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }`;

/** Converts the premultiplied composite into straight-alpha RGBA8 for read-back. */
export const RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
out vec4 outColor;
void main() {
  vec4 c = texelFetch(u_image, ivec2(gl_FragCoord.xy), 0);
  outColor = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}`;

/** Draws the composite into the viewport with pan/zoom over a transparency checkerboard. */
export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_docSize;
uniform vec2 u_canvasSize;   // device pixels
uniform float u_scale;       // device pixels per document pixel
uniform vec2 u_offset;       // device-pixel position of the document origin
uniform float u_checkerSize; // device pixels
uniform vec3 u_checkerA;
uniform vec3 u_checkerB;
uniform vec3 u_background;
uniform bool u_smooth;
out vec4 outColor;

void main() {
  vec2 screen = vec2(gl_FragCoord.x, u_canvasSize.y - gl_FragCoord.y);
  vec2 doc = (screen - u_offset) / u_scale;
  if (doc.x < 0.0 || doc.y < 0.0 || doc.x >= u_docSize.x || doc.y >= u_docSize.y) {
    outColor = vec4(u_background, 1.0);
    return;
  }
  vec2 cell = floor((screen - u_offset) / u_checkerSize);
  vec3 checker = mod(cell.x + cell.y, 2.0) < 1.0 ? u_checkerA : u_checkerB;
  vec4 c = u_smooth ? texture(u_image, doc / u_docSize) : texelFetch(u_image, ivec2(doc), 0);
  outColor = vec4(c.rgb + checker * (1.0 - c.a), 1.0);
}`;
