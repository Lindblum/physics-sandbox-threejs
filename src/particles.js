import * as THREE from 'three';

// Particles: what smoke, steam, fire, lava, glowing things give off all the
// time (a material's `particles` column), and what flies where some are struck
// (`impact_particles`: sand's dust, water's splash, lava's sparks). Soft round
// sprites simulated on the CPU, drawn as two batches of points: glowing ones
// added onto what's behind them, the rest (smoke, dust) laid over it.

/**
 * The presets. rate: per second from a 10 cm object; life: [min, max] s;
 * size: [at birth, at death] m; speed: m/s outward at birth; rise: m/s² up
 * (hot gas) and gravity: share of g down; drag: per second; colors: over its
 * life (or 'material' / 'emissive': the object's own); alpha: at its densest;
 * glow: added onto the scene; floor: they lie on the disc (FLOOR) rather than
 * sink through it; flat: they set off sideways; wander: m/s² of random
 * buffeting (eddies in the air).
 */
const PRESETS = {
  smoke: { rate: 25, life: [1.8, 3], size: [0.04, 0.18], speed: 0.04, rise: 0.25, drag: 1.5, colors: ['#8a8a8e', '#4e4e54'], alpha: 0.4, glow: false },
  steam: { rate: 30, life: [1, 1.8], size: [0.03, 0.14], speed: 0.05, rise: 0.4, drag: 1.5, colors: ['#ffffff', '#e8eef4'], alpha: 0.35, glow: false },
  fire: { rate: 60, life: [0.35, 0.75], size: [0.045, 0.006], speed: 0.05, rise: 1.2, drag: 2, colors: ['#ffd27a', '#ff6a10', '#801000'], alpha: 0.35, glow: true },
  sparks: { rate: 5, life: [0.5, 1.1], size: [0.01, 0.003], speed: 0.6, gravity: 1, drag: 0.5, colors: ['#ffe08a', '#ff4a00'], alpha: 1, glow: true },
  motes: { rate: 8, life: [1, 2.2], size: [0.012, 0], speed: 0.06, rise: 0.02, drag: 1, colors: ['emissive'], alpha: 0.9, glow: true },
  dust: { rate: 0, life: [0.6, 1.3], size: [0.008, 0.035], speed: 0.45, gravity: 0.25, drag: 3, colors: ['material'], alpha: 0.55, glow: false },
  // heavy fog: sinks, and spreads out over the floor (the disc) rather than through it
  fog: { rate: 18, life: [3, 5], size: [0.06, 0.3], speed: 0.12, gravity: 0.03, drag: 0.8, colors: ['#eef2f5', '#dfe6ea'], alpha: 0.22, glow: false, floor: true, flat: true },
  // haze: soft, faint puffs hanging in the air, drifting
  haze: { rate: 14, life: [4, 7], size: [0.08, 0.2], speed: 0.03, drag: 1, wander: 0.05, colors: ['#e4e8ec', '#d4dadf'], alpha: 0.09, glow: false },
  // dander: tiny flakes fluttering, slowly settling on the floor
  dander: { rate: 25, life: [5, 9], size: [0.004, 0.004], speed: 0.04, gravity: 0.004, drag: 2, wander: 0.4, colors: ['material'], alpha: 0.9, glow: false, floor: true },
  splash: { rate: 0, life: [0.35, 0.8], size: [0.01, 0.004], speed: 0.9, gravity: 1, drag: 0.3, colors: ['material'], alpha: 0.85, glow: false },
};

const MAX = 3000; // particles per batch
const G = 9.81;
const FLOOR = { y: 0, radius: 1 }; // the disc's top, for particles that lie on it

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float halfHeight; // the viewport's half height, px
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(512.0, size * projectionMatrix[1][1] * halfHeight / max(0.01, -mv.z));
    vAlpha = alpha;
    vTint = tint;
  }
`;
const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vAlpha * (1.0 - smoothstep(0.2, 1.0, d));
    if (a < 0.004) discard;
    gl_FragColor = vec4(vTint, a);
    #include <colorspace_fragment>
  }
`;

class Batch {
  constructor(glow) {
    this.n = 0;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.sizes = new Float32Array(MAX * 2);
    this.colors = []; // per particle: its preset's colours (THREE.Color[])
    this.props = []; // per particle: { rise, gravity, drag, alpha }
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('size', this.size);
    this.geometry.setAttribute('alpha', this.alpha);
    this.geometry.setAttribute('tint', this.tint);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { halfHeight: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = glow ? 6 : 5;
    this.points.raycast = () => {};
  }

  add(p, v, life, size, colors, props) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.sizes[i * 2] = size[0];
    this.sizes[i * 2 + 1] = size[1];
    this.colors[i] = colors;
    this.props[i] = props;
  }

  /** Moves them on by `dt` and writes what the GPU draws. */
  step(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // the last takes its place
        const j = --this.n;
        this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
        this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
        this.age[i] = this.age[j];
        this.life[i] = this.life[j];
        this.sizes[i * 2] = this.sizes[j * 2];
        this.sizes[i * 2 + 1] = this.sizes[j * 2 + 1];
        this.colors[i] = this.colors[j];
        this.props[i] = this.props[j];
        continue;
      }
      const { rise, gravity, drag, alpha, floor, wander } = this.props[i];
      const k = Math.exp(-drag * dt);
      const v = this.vel;
      if (wander) for (let a = 0; a < 3; a++) v[i * 3 + a] += (Math.random() - 0.5) * 2 * wander * dt;
      v[i * 3] *= k;
      v[i * 3 + 1] = v[i * 3 + 1] * k + (rise - gravity * G) * dt;
      v[i * 3 + 2] *= k;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += v[i * 3 + a] * dt;
      if (floor && this.pos[i * 3 + 1] < FLOOR.y + 0.01 && Math.hypot(this.pos[i * 3], this.pos[i * 3 + 2]) < FLOOR.radius) {
        // on the floor: it stops sinking and drifts on outward
        this.pos[i * 3 + 1] = FLOOR.y + 0.01;
        v[i * 3 + 1] = Math.max(0, v[i * 3 + 1]);
      }
      const t = this.age[i] / this.life[i];
      this.position.array.set(this.pos.subarray(i * 3, i * 3 + 3), i * 3);
      this.size.array[i] = this.sizes[i * 2] + (this.sizes[i * 2 + 1] - this.sizes[i * 2]) * t;
      // fades in fast, out slowly
      this.alpha.array[i] = alpha * Math.min(1, t * 10) * (1 - t);
      const cs = this.colors[i];
      const f = t * (cs.length - 1);
      const c0 = cs[Math.floor(f)];
      const c1 = cs[Math.min(cs.length - 1, Math.floor(f) + 1)];
      const u = f - Math.floor(f);
      this.tint.array[i * 3] = c0.r + (c1.r - c0.r) * u;
      this.tint.array[i * 3 + 1] = c0.g + (c1.g - c0.g) * u;
      this.tint.array[i * 3 + 2] = c0.b + (c1.b - c0.b) * u;
      i++;
    }
    this.geometry.setDrawRange(0, this.n);
    for (const a of [this.position, this.size, this.alpha, this.tint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

const colorCache = new Map();
function presetColors(preset, material) {
  const key = `${preset.colors.join()}|${material?.id}`;
  if (!colorCache.has(key))
    colorCache.set(
      key,
      preset.colors.map((c) => new THREE.Color(c === 'material' ? material.look.color : c === 'emissive' ? material.look.emissive ?? material.look.color : c)),
    );
  return colorCache.get(key);
}

const rand = (a, b) => a + Math.random() * (b - a);
const _dir = new THREE.Vector3();

/** The particles in the scene: one of these, its two batches' points added to the scene (see Particles in Physics.jsx). */
export class ParticleSystem {
  constructor() {
    this.glow = new Batch(true);
    this.plain = new Batch(false);
    this.owed = new Map(); // emitter key -> particles owed (fractional)
    this.density = 1; // Video → Particles: High 1, Low about a third
  }

  get objects() {
    return [this.plain.points, this.glow.points];
  }

  /** One particle of preset `p` at `at` (a THREE.Vector3), flying out along a random direction at its speed (× `speed`). */
  spawn(p, material, at, speed = 1) {
    const preset = PRESETS[p];
    if (!preset) return;
    _dir.randomDirection();
    if (preset.flat) _dir.y *= 0.2;
    else if (preset.gravity) _dir.y = Math.abs(_dir.y) * 0.8 + 0.2; // (sprays up and out)
    const s = preset.speed * speed * rand(0.4, 1);
    const props = { rise: preset.rise ?? 0, gravity: preset.gravity ?? 0, drag: preset.drag ?? 0, alpha: preset.alpha, floor: Boolean(preset.floor), wander: preset.wander ?? 0 };
    (preset.glow ? this.glow : this.plain).add([at.x, at.y, at.z], [_dir.x * s, _dir.y * s, _dir.z * s], rand(...preset.life), preset.size, presetColors(preset, material), props);
  }

  /**
   * An object giving off its particles for `dt` s: `key` names it, `center` (a
   * Vector3) is where it is and `radius` how far from there they start;
   * `scale`: how many, by its size (1 for a 10 cm one).
   */
  emit(key, material, center, radius, dt, scale = 1) {
    const { preset: name, rate } = material.particles;
    const preset = PRESETS[name];
    if (!preset) return;
    let owed = (this.owed.get(key) ?? 0) + preset.rate * rate * scale * this.density * dt;
    const at = new THREE.Vector3();
    while (owed >= 1) {
      owed -= 1;
      at.randomDirection().multiplyScalar(radius * Math.cbrt(Math.random())).add(center);
      this.spawn(name, material, at);
    }
    this.owed.set(key, owed);
  }

  /** Where something of `material` is struck at `at`, `speed` m/s: its impact particles, more the harder. */
  burst(material, at, speed) {
    const name = material.impactParticles;
    if (!name || speed < 0.4) return;
    const count = Math.min(40, Math.round(speed * 10 * this.density));
    for (let i = 0; i < count; i++) this.spawn(name, material, at, Math.min(2, 0.5 + speed * 0.3));
  }

  forget(key) {
    this.owed.delete(key);
  }

  /** Each frame: `halfHeight`, the viewport's half height in px (the particles' size on screen). */
  step(dt, halfHeight) {
    for (const b of [this.glow, this.plain]) {
      b.material.uniforms.halfHeight.value = halfHeight;
      b.step(dt);
    }
  }
}
