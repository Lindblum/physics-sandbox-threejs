import * as THREE from 'three';

// Each material's surface: a procedural, seamlessly tiling pattern (its
// `texture` column), drawn once as a height field, from which come
//   a colour map    lighter on the highs, darker in the lows, by pattern_contrast
//   a normal map    the bumps, as deep as normal_strength (the material's normalScale)
//   a roughness map polished highs, rougher lows, by roughness_variance
//   a glow map      for emissive_pattern: the glow only in the hollows (lava's cracks)
// Maps are canvases, so the exported scene carries them too (see sceneFile.js).
// Objects' UVs are in metres (see shapes.js), so a map repeats every texture_scale_m.

const SIZE = 256; // px a side

// a seeded random number per integer lattice point, the same every run
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise at (u, v) in [0, 1)², tiling: `period` cells across each way (per axis: [pu, pv]). */
function noise(u, v, [pu, pv], seed) {
  const x = u * pu;
  const y = v * pv;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i, j) => hash(((x0 + i) % pu + pu) % pu, ((y0 + j) % pv + pv) % pv, seed);
  const a = w(0, 0) + (w(1, 0) - w(0, 0)) * sx;
  const b = w(0, 1) + (w(1, 1) - w(0, 1)) * sx;
  return a + (b - a) * sy;
}

/** Fractal noise: `octaves` of noise, each twice as fine and half as strong, from `period`; 0 to 1. */
function fbm(u, v, period, octaves, seed) {
  let total = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += amp * noise(u, v, [period[0] << o, period[1] << o], seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return total / norm;
}

/** Cells (tiling Voronoi), `n` across: { f1, f2 } nearest and second-nearest distances (in cells), `id` of the nearest. */
function cells(u, v, n, seed) {
  const x = u * n;
  const y = v * n;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  let near = null;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const gy = cy + j;
      const wx = ((gx % n) + n) % n;
      const wy = ((gy % n) + n) % n;
      const px = gx + hash(wx, wy, seed);
      const py = gy + hash(wx, wy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wy * n + wx;
        near = [px - x, py - y];
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id, near };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Each pattern: (u, v) -> { h: height, 0 low to 1 high; c?: its own lightness, where it isn't the height }. */
const PATTERNS = {
  ripple: (u, v) => ({ h: fbm(u, v, [3, 3], 3, 1) }),
  grainy: (u, v) => ({ h: 0.6 * fbm(u, v, [32, 32], 3, 2) + 0.4 * hash(Math.floor(u * SIZE), Math.floor(v * SIZE), 3) }),
  mottled: (u, v) => ({ h: fbm(u, v, [4, 4], 4, 4) }),
  // wood: growth rings running along v, wavering
  grain: (u, v) => {
    const ring = (u * 9 + fbm(u, v, [2, 4], 3, 5) * 2.5) % 1;
    return { h: 0.75 * smooth(0, 0.8, ring) * (1 - smooth(0.85, 1, ring)) + 0.25 * fbm(u, v, [64, 4], 2, 6) };
  },
  // brushed metal: fine streaks along u
  brushed: (u, v) => ({ h: 0.7 * fbm(u, v, [2, 128], 3, 7) + 0.3 * fbm(u, v, [4, 32], 2, 8) }),
  fibers: (u, v) => ({ h: 0.5 * fbm(u, v, [8, 64], 3, 9) + 0.5 * fbm(u, v, [64, 8], 3, 10) }),
  // cloth: threads over and under in a checker of 32 a side
  weave: (u, v) => {
    const n = 32;
    const i = Math.floor(u * n);
    const j = Math.floor(v * n);
    const over = (i + j) % 2 === 0;
    const across = over ? (v * n) % 1 : (u * n) % 1;
    const along = over ? (u * n) % 1 : (v * n) % 1;
    return { h: Math.sin(Math.PI * across) * (0.7 + 0.3 * Math.sin(Math.PI * along)) * (0.85 + 0.15 * hash(i, j, 11)) };
  },
  pebbled: (u, v) => ({ h: 1 - Math.min(1, cells(u, v, 24, 12).f1 * 1.4) }),
  pores: (u, v) => {
    const { f1 } = cells(u, v, 20, 13);
    return { h: smooth(0.15, 0.4, f1) * (0.8 + 0.2 * fbm(u, v, [8, 8], 2, 14)) };
  },
  porous: (u, v) => {
    const { f1 } = cells(u, v, 16, 15);
    return { h: 0.7 * fbm(u, v, [16, 16], 4, 16) + 0.3 * smooth(0.05, 0.25, f1) };
  },
  // granite, porcelain flecks: grains of their own shade
  speckle: (u, v) => {
    const { id, f2, f1 } = cells(u, v, 48, 17);
    const shade = hash(id, 0, 18);
    return { h: 0.5 + 0.5 * smooth(0, 0.1, f2 - f1), c: shade < 0.15 ? 0.1 : shade > 0.85 ? 1 : 0.55 + 0.2 * shade };
  },
  // marble: dark veins wandering through it
  veins: (u, v) => {
    const t = Math.abs(Math.sin(Math.PI * (u * 2 + v + fbm(u, v, [4, 4], 5, 19) * 3)));
    return { h: 0.8 + 0.2 * fbm(u, v, [8, 8], 2, 20), c: smooth(0, 0.25, t) };
  },
  hammered: (u, v) => {
    const { f1 } = cells(u, v, 10, 21);
    return { h: 1 - f1 * f1 * 1.6 };
  },
  // cracks between plates (ice, lava's crust)
  cracks: (u, v) => {
    const { f1, f2 } = cells(u, v, 6, 22);
    return { h: smooth(0, 0.08, f2 - f1) * (0.85 + 0.15 * fbm(u, v, [16, 16], 3, 23)) };
  },
  // crystal facets: each cell a flat face at its own tilt
  crystal: (u, v) => {
    const { id, near, f1, f2 } = cells(u, v, 8, 24);
    const tx = hash(id, 1, 25) - 0.5;
    const ty = hash(id, 2, 25) - 0.5;
    return { h: Math.min(1, Math.max(0, 0.5 + tx * near[0] * 1.5 + ty * near[1] * 1.5)) * smooth(0, 0.05, f2 - f1), c: 0.7 + 0.3 * hash(id, 3, 25) + 0 * f1 };
  },
};

export const PATTERN_NAMES = Object.keys(PATTERNS);

// a pattern's fields, once: { h, c } each SIZE² floats
const fields = new Map();
function field(name) {
  if (!fields.has(name)) {
    const pattern = PATTERNS[name];
    const h = new Float32Array(SIZE * SIZE);
    const c = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const p = pattern((x + 0.5) / SIZE, (y + 0.5) / SIZE);
        h[y * SIZE + x] = p.h;
        c[y * SIZE + x] = p.c ?? p.h;
      }
    fields.set(name, { h, c });
  }
  return fields.get(name);
}

function canvasTexture(fill, srgb) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(SIZE, SIZE);
  fill(image.data);
  ctx.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const maps = new Map();
/**
 * A material's maps (see materials.js look), or null without a texture:
 * { map, normalMap, roughnessMap, emissiveMap?, mean (the colour map's mean, to keep the colour true) }.
 */
export function materialMaps(material) {
  const look = material.look;
  if (!look.texture || !PATTERNS[look.texture]) return null;
  if (maps.has(material.id)) return maps.get(material.id);
  const { h, c } = field(look.texture);
  const contrast = look.patternContrast;
  const rough = look.roughnessVariance;
  let sum = 0;
  const shade = (i) => 1 - contrast * (1 - c[i]);
  const map = canvasTexture((d) => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = shade(i);
      sum += v;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(255 * v);
      d[i * 4 + 3] = 255;
    }
  }, true);
  // the slopes, wrapping round the edges (a 1 px rise across a texel is about 45°)
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const normalMap = canvasTexture((d) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 4;
        const dy = (at(x, y + 1) - at(x, y - 1)) * 4;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * SIZE + x) * 4;
        d[i] = Math.round(127.5 * (1 - dx / len));
        d[i + 1] = Math.round(127.5 * (1 + dy / len)); // (+y up in the map: three.js's convention)
        d[i + 2] = Math.round(127.5 * (1 + 1 / len));
        d[i + 3] = 255;
      }
  }, false);
  // roughness rides in the green channel; the material's own roughness is the most it gets
  const roughnessMap = canvasTexture((d) => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      d[i * 4] = d[i * 4 + 2] = 0;
      d[i * 4 + 1] = Math.round(255 * (1 - rough * h[i]));
      d[i * 4 + 3] = 255;
    }
  }, false);
  const emissiveMap = look.emissivePattern
    ? canvasTexture((d) => {
        for (let i = 0; i < SIZE * SIZE; i++) {
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(255 * Math.pow(1 - h[i], 3));
          d[i * 4 + 3] = 255;
        }
      }, true)
    : null;
  const repeat = 1 / look.textureScale;
  for (const t of [map, normalMap, roughnessMap, emissiveMap]) t?.repeat.set(repeat, repeat);
  const entry = { map, normalMap, roughnessMap, emissiveMap, mean: sum / (SIZE * SIZE) };
  maps.set(material.id, entry);
  return entry;
}
