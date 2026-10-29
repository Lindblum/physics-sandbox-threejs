import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BallCollider,
  CoefficientCombineRule,
  ConvexHullCollider,
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  interactionGroups,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRapier,
} from '@react-three/rapier';
import * as THREE from 'three';
import { AIR_DENSITY, DISC_MATERIAL, STARTING_MATERIALS, materialById } from './materials.js';
import { CUBE_SIZE, CYLINDER, SPHERE_RADIUS, shapeOf, transformedShape } from './shapes.js';
import { pulseHand } from './grip.js';
import { materialMaps } from './textures.js';
import { ParticleSystem } from './particles.js';
import { impact, scrape, setListener, updateSounds } from './sound.js';

export { CUBE_SIZE, SPHERE_RADIUS };

// The sandbox: a solid disc for a floor, fixed in place (gravity doesn't move
// it and it can't be picked up), its top the real floor, and the objects on it,
// each a solid shape (see shapes.js) of one material (see materials.js), with
// its mass, friction and bounce, all real size. To start with, ten cubes, one
// of each of ten materials, dropped from 10 cm above the disc at random places
// on it. An object that falls off the disc (or floats away) goes: one of the
// first ten comes back above the disc, one made since is gone.
//
// Everything moves through air (the materials table's): it drags on them
// (more on light, broad things) and buoys them up, so a gas lighter than air
// rises. Gases and plasmas don't collide with anything. Where things strike or
// slide on each other they sound like what they're made of (see sound.js), and
// some throw up particles (see particles.js); some give them off all the time,
// some glow and light what's around them, some wobble when struck.
//
// An object held (by a grip, or dragged with the Select tool) is kinematic: it
// goes where the hand puts it, shoving others aside, and let go it carries on
// at the hand's last velocity and spin, so it can be thrown (see Holds).

export const DISC = { radius: 1, thickness: 0.1 }; // m; its top is the floor, y = 0
const SPAWN_DROP = 0.1; // m: the first cubes start this far above the disc
const SPAWN_REACH = DISC.radius - 0.15; // m from the centre: where they may start
const SPAWN_APART = 0.17; // m between their centres at least
const FALLEN_Y = -10; // m: below this an object has fallen off for good
const FLOWN_Y = 30; // m: above this one has floated away for good
const MAX_MADE = 100; // objects made with the Tools at once (the oldest goes)
const MAX_THROW = 25; // m/s: the fastest a let-go object flies
const MAX_SPIN = 30; // rad/s
const VARIANTS = 6; // looks per material, a little apart by its colour_variance

const DYNAMIC = 0; // Rapier's RigidBodyType
const KINEMATIC = 2; // (KinematicPositionBased)
/**
 * Who bumps into whom: the disc, the objects (and grains), and things that
 * touch only the floor (heavy fog), which pass through the objects.
 */
export const GROUPS = { disc: interactionGroups([0]), object: interactionGroups([1]), floorOnly: interactionGroups([2], [0]) };
const COMBINE = { average: CoefficientCombineRule.Average, max: CoefficientCombineRule.Max, min: CoefficientCombineRule.Min, multiply: CoefficientCombineRule.Multiply };

let nextId = 1;

/**
 * A new object: { id, shape (see shapes.js), material (id), position,
 * rotation (Euler XYZ), start (one of the first ten), linvel?, angvel?,
 * transform? (a 3×3 matrix, column-major, on the shape's own space: it's been
 * resized or stretched, see Grab.jsx) }.
 */
export function makeBody(shape, material, position, rotation = [0, Math.random() * Math.PI * 2, 0], start = false, motion = {}) {
  return { id: nextId++, shape, material, position, rotation, start, ...motion };
}

/** The first ten: a cube of each starting material, at random places on the disc, apart from each other. */
export function startingBodies() {
  const placed = [];
  return STARTING_MATERIALS.map((material) => {
    let p;
    for (let tries = 0; tries < 200; tries++) {
      const r = SPAWN_REACH * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      p = [r * Math.cos(a), CUBE_SIZE / 2 + SPAWN_DROP, r * Math.sin(a)];
      if (placed.every((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) >= SPAWN_APART)) break;
    }
    placed.push(p);
    return makeBody('cube', material.id, p, undefined, true);
  });
}

/** Where a starting object that fell off comes back: somewhere on the disc, 10 cm up. */
function respawned(def) {
  const r = SPAWN_REACH * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  return makeBody(def.shape, def.material, [r * Math.cos(a), shapeOf(def.shape).radius + SPAWN_DROP, r * Math.sin(a)], undefined, true);
}

/** Bodies after `made` is added: the oldest made ones go past MAX_MADE. */
export function withMade(bodies, made) {
  const next = [...bodies, made];
  const madeCount = next.filter((b) => !b.start).length;
  if (madeCount <= MAX_MADE) return next;
  const oldest = next.find((b) => !b.start);
  return next.filter((b) => b !== oldest);
}

// a repeatable random number for (a, b)
const jitter = (a, b) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
const _hsl = { h: 0, s: 0, l: 0 };

/** Video's settings the looks follow: Refraction, Surface Detail (see setLookQuality). */
const lookQuality = { refraction: true, surfaceDetail: true };
const LOOKS = new Map();
const lookListeners = new Set();

/**
 * Video → Refraction and Surface Detail changed: every look is made again
 * (call while rendering, before the objects are; `onLooksChanged` hears it).
 */
export function setLookQuality({ refraction, surfaceDetail }) {
  if (refraction === lookQuality.refraction && surfaceDetail === lookQuality.surfaceDetail) return;
  Object.assign(lookQuality, { refraction, surfaceDetail });
  for (const look of LOOKS.values()) look.dispose();
  LOOKS.clear();
  for (const f of lookListeners) f();
}
export const onLooksChanged = (f) => lookListeners.add(f);

/**
 * A material's look as a three.js material: its colour (look `variant` of
 * VARIANTS, apart by its colour_variance), surface pattern (its bumps and
 * shine with Surface Detail), shine and glow. `transmission`: see-through as
 * glass is, refracting by its ior (Video → Refraction; always in the exported
 * scene); without it the table's opacity stands in (far cheaper).
 */
export function lookMaterial(material, { variant = 0, transmission = lookQuality.refraction, detail = lookQuality.surfaceDetail } = {}) {
  const l = material.look;
  const transparent = l.opacity < 1;
  const look = new THREE.MeshPhysicalMaterial({
    name: material.name,
    color: l.color,
    roughness: l.roughness,
    metalness: l.metalness,
    ior: Math.min(2.333, Math.max(1, l.ior)),
    sheen: l.sheen,
    clearcoat: l.clearcoat,
    // reflectance 0.5: a dielectric's usual mirroring at its ior; less is duller
    specularIntensity: Math.min(1, l.reflectance * 2),
  });
  if (variant && l.colorVariance) {
    const v = l.colorVariance;
    look.color.getHSL(_hsl);
    look.color.setHSL(
      (_hsl.h + jitter(variant, 1) * v * 0.08 + 1) % 1,
      THREE.MathUtils.clamp(_hsl.s * (1 + jitter(variant, 2) * v * 0.5), 0, 1),
      THREE.MathUtils.clamp(_hsl.l * (1 + jitter(variant, 3) * v * 0.5), 0, 1),
    );
  }
  if (l.sheen) look.sheenColor.copy(look.color);
  const maps = materialMaps(material);
  if (maps) {
    look.map = maps.map;
    look.color.multiplyScalar(1 / maps.mean); // (the pattern darkens on average: kept true to the table's colour)
    if (l.normalStrength && detail) {
      look.normalMap = maps.normalMap;
      look.normalScale.setScalar(l.normalStrength);
    }
    if (l.roughnessVariance && detail) look.roughnessMap = maps.roughnessMap;
  }
  if (l.emissive) {
    look.emissive.set(l.emissive);
    look.emissiveIntensity = l.emissiveIntensity;
    if (maps?.emissiveMap) look.emissiveMap = maps.emissiveMap;
  }
  if (transmission && l.transmission > 0) {
    // (thick enough to bend what's behind it, as a 10 cm object does)
    Object.assign(look, { transmission: l.transmission, thickness: 0.05 });
  }
  else if (transparent) Object.assign(look, { transparent, opacity: l.opacity, depthWrite: false });
  return look;
}

export function lookOf(material, variant = 0) {
  const key = `${material.id}:${variant}`;
  if (!LOOKS.has(key)) LOOKS.set(key, lookMaterial(material, { variant }));
  return LOOKS.get(key);
}

/**
 * Who holds which objects: a grip ('left' / 'right') or a dragging pointer.
 * Each frame the held ones are moved where they were last put (kinematically),
 * and their velocity and spin are followed, so letting go throws them.
 * `registry`: id -> { body (ref to the Rapier body), collider (ref: the first
 * collider), mesh (ref), def, material, shape, measure ({ size, radius, half,
 * volume }: as resized), base (Matrix4: the mesh's, its resizing), preview
 * (Matrix4 or null: resizing it now, see Grab.jsx), jiggle }.
 */
export class Holds {
  constructor(registry) {
    this.registry = registry;
    this.map = new Map(); // id -> { by, position, quaternion, last?, velocity, spin }
  }

  /** The hands holding `id` (both while it's being resized). */
  handsOf(id) {
    const h = this.map.get(id);
    if (!h) return [];
    return h.hands ?? (h.by === 'left' || h.by === 'right' ? [h.by] : []);
  }

  /** Whether `id` is held (by anyone, or by `by`). */
  isHeld(id, by) {
    const h = this.map.get(id);
    return Boolean(h && (by === undefined || h.by === by));
  }

  /** `by` takes object `id` (from whoever had it). Returns false if it's gone. */
  take(id, by) {
    const body = this.registry.get(id)?.body.current;
    if (!body) return false;
    const t = body.translation();
    const r = body.rotation();
    body.setBodyType(KINEMATIC, true);
    this.map.set(id, {
      by,
      position: new THREE.Vector3(t.x, t.y, t.z),
      quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      last: null,
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
    });
    return true;
  }

  /** Puts held object `id` at `position`, turned to `quaternion` (by its holder only). */
  move(id, by, position, quaternion) {
    const h = this.map.get(id);
    if (!h || h.by !== by) return;
    h.position.copy(position);
    if (quaternion) h.quaternion.copy(quaternion);
  }

  /** `by` lets go of `id`: it flies on at the velocity and spin it had (`still`: it stays put). */
  release(id, by, still = false) {
    const h = this.map.get(id);
    if (!h || h.by !== by) return;
    this.map.delete(id);
    const body = this.registry.get(id)?.body.current;
    if (!body) return;
    body.setBodyType(DYNAMIC, true);
    body.setLinvel(still ? { x: 0, y: 0, z: 0 } : h.velocity.clampLength(0, MAX_THROW), true);
    body.setAngvel(still ? { x: 0, y: 0, z: 0 } : h.spin.clampLength(0, MAX_SPIN), true);
  }

  /** One frame: the held objects to where they were put, and how fast they moved there. */
  step(dt) {
    for (const [id, h] of this.map) {
      const body = this.registry.get(id)?.body.current;
      if (!body) {
        this.map.delete(id);
        continue;
      }
      body.setNextKinematicTranslation(h.position);
      body.setNextKinematicRotation(h.quaternion);
      if (h.last && dt > 0) {
        _v.subVectors(h.position, h.last.position).divideScalar(dt);
        h.velocity.lerp(_v, 0.5);
        // the turn since last frame, as an axis times its angle per second
        _dq.copy(h.quaternion).multiply(_qi.copy(h.last.quaternion).invert());
        if (_dq.w < 0) _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
        const angle = 2 * Math.acos(Math.min(1, _dq.w));
        const s = Math.sqrt(1 - _dq.w * _dq.w);
        if (s > 1e-6) _v.set(_dq.x / s, _dq.y / s, _dq.z / s).multiplyScalar(angle / dt);
        else _v.set(0, 0, 0);
        h.spin.lerp(_v, 0.5);
      }
      h.last = { position: h.position.clone(), quaternion: h.quaternion.clone() };
    }
  }
}

const _v = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/**
 * The floor: a fixed disc of concrete, its top at y = 0. Clicks on it reach
 * `onClick` (and pointers reach `handlers`); `colliderRef` and `meshRef` get its collider and mesh. Its friction is high, so each
 * object's own decides how it slides on it.
 */
export function Disc({ onClick, colliderRef, meshRef, handlers }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, -DISC.thickness / 2, 0]}>
      <CylinderCollider ref={colliderRef} args={[DISC.thickness / 2, DISC.radius]} friction={1} restitution={0.3} collisionGroups={GROUPS.disc} />
      <mesh ref={meshRef} receiveShadow onClick={onClick} material={lookOf(DISC_MATERIAL)} {...handlers}>
        <cylinderGeometry args={[DISC.radius, DISC.radius, DISC.thickness, 96]} />
      </mesh>
    </RigidBody>
  );
}

/** A shape's collider(s), resized by `transform` if it has one, with `surface`'s friction, bounce and density (`ref`: the first). */
function Colliders({ shape, transform, surface }) {
  const hulls = (pieces) => pieces.map((points, i) => <ConvexHullCollider key={i} args={[points]} {...surface} ref={i === 0 ? surface.ref : undefined} />);
  if (transform) return hulls(transformedShape(shape.id, transform).pieces);
  if (shape.id === 'cube') return <CuboidCollider args={[CUBE_SIZE / 2, CUBE_SIZE / 2, CUBE_SIZE / 2]} {...surface} />;
  if (shape.id === 'sphere') return <BallCollider args={[SPHERE_RADIUS]} {...surface} />;
  if (shape.id === 'cylinder') return <CylinderCollider args={[CYLINDER.height / 2, CYLINDER.radius]} {...surface} />;
  return hulls(shape.pieces);
}

/** A shape's measures as resized by `transform` (or not): { size, radius, half, volume }. */
function measureOf(shape, transform) {
  if (!transform) return { size: shape.size, radius: shape.radius, half: shape.half, volume: shape.volume };
  const t = transformedShape(shape.id, transform);
  return { size: t.size, radius: t.radius, half: t.half, volume: t.volume };
}

/** A resizing's 3×3 as the mesh's matrix. */
export function transformMatrix(transform) {
  const m = new THREE.Matrix4();
  if (transform) m.setFromMatrix3(new THREE.Matrix3().fromArray(transform));
  return m;
}

/**
 * One object. `registry` gets its body and mesh by id; `handlers`: the
 * pointer handlers for its mesh (see Scene.jsx: dragging and the tools).
 */
function SandboxBody({ def, registry, handlers }) {
  const body = useRef(null);
  const collider = useRef(null);
  const mesh = useRef(null);
  const material = materialById(def.material);
  const shape = shapeOf(def.shape);
  const base = useMemo(() => transformMatrix(def.transform), [def.transform]);
  useEffect(() => {
    registry.set(def.id, { body, collider, mesh, def, material, shape, measure: measureOf(shape, def.transform), base, preview: null, jiggle: null });
    return () => {
      registry.delete(def.id);
      particles.forget(def.id);
    };
  }, [registry, def, material, shape, base]);
  const surface = {
    ref: collider,
    friction: material.friction,
    restitution: material.restitution,
    frictionCombineRule: CoefficientCombineRule.Min,
    restitutionCombineRule: COMBINE[material.restitutionCombine] ?? CoefficientCombineRule.Average,
    density: material.density,
    sensor: material.collides === 'none', // (a gas or plasma passes through things)
    collisionGroups: material.collides === 'floor' ? GROUPS.floorOnly : GROUPS.object, // (heavy fog: the floor only)
  };
  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={def.position}
      rotation={def.rotation}
      // (a scene opened carries on moving; rapier wants these left out, not undefined)
      {...(def.linvel && { linearVelocity: def.linvel })}
      {...(def.angvel && { angularVelocity: def.angvel })}
      // buoyancy: the air it pushes aside holds it up (a gas lighter than air rises), unless it says otherwise
      gravityScale={material.gravityScale ?? 1 - AIR_DENSITY / material.density}
      linearDamping={material.damping}
      angularDamping={material.damping}
      canSleep
    >
      <Colliders shape={shape} transform={def.transform} surface={surface} />
      <mesh
        ref={mesh}
        matrixAutoUpdate={false}
        matrix={base}
        geometry={shape.geometry}
        material={lookOf(material, def.id % VARIANTS)}
        castShadow={material.look.opacity > 0.3}
        receiveShadow
        userData={{ bodyId: def.id }}
        {...handlers(def.id)}
      />
    </RigidBody>
  );
}

// a struck object's wobble: squashed along its up and bulging round it, springing back
const JIGGLE_RATE = 28; // rad/s
const JIGGLE_FADE = 0.35; // s to fade by e
const _up = new THREE.Vector3();
const _jig = new THREE.Matrix4();

/** Starts `entry`'s wobble, as hard as a strike of `speed` m/s. */
function jiggle(entry, speed) {
  const amount = entry.material.jiggle * Math.min(0.3, speed * 0.1);
  if (amount > (entry.jiggle?.amount ?? 0) * 0.5) entry.jiggle = { amount, t: 0 };
}

/**
 * The objects, and each frame: the held ones moved (see Holds), wobbling ones
 * wobbled, and any that fell off the disc or floated away taken away or, the
 * first ten, put back above it. `setBodies` updates the list.
 */
export function SandboxBodies({ bodies, setBodies, registry, holds, handlers }) {
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    holds.step(dt);
    let fallen = null;
    for (const [id, entry] of registry) {
      const b = entry.body.current;
      const y = b?.translation().y;
      if (y < FALLEN_Y || y > FLOWN_Y) (fallen ??= new Set()).add(id);
      // the mesh: as resized (or being resized), and wobbling
      const m = entry.mesh.current;
      if (!m) continue;
      const j = entry.jiggle;
      _jig.identity();
      if (j) {
        j.t += dt;
        const a = j.amount * Math.exp(-j.t / JIGGLE_FADE) * Math.sin(j.t * JIGGLE_RATE);
        if (j.t > JIGGLE_FADE * 5) entry.jiggle = null;
        else {
          // squashed along the world's up, in the object's own axes: the nearest of them
          _up.set(0, 1, 0).applyQuaternion(b ? _dq.copy(b.rotation()).invert() : _dq.identity());
          const ax = Math.abs(_up.x);
          const ay = Math.abs(_up.y);
          const az = Math.abs(_up.z);
          const s = 1 - a;
          const w = 1 + a / 2;
          _jig.makeScale(ax >= ay && ax >= az ? s : w, ay > ax && ay >= az ? s : w, az > ax && az > ay ? s : w);
        }
      }
      m.matrix.multiplyMatrices(entry.preview ?? entry.base, _jig);
      m.matrixWorldNeedsUpdate = true;
    }
    if (!fallen) return;
    for (const id of fallen) registry.delete(id); // (not again next frame, before React catches up)
    setBodies((list) => list.flatMap((b) => (!fallen.has(b.id) ? [b] : b.start ? [respawned(b)] : [])));
  });
  // (the grains of a liquid or sand are Fluids.jsx's)
  return bodies.map((def) => !def.fluid && <SandboxBody key={def.id} def={def} registry={registry} handlers={handlers} />);
}

/** Before each step: the air drags on each moving object (½ ρ C A v², against its motion). */
export function AirDrag({ registry }) {
  useBeforePhysicsStep((world) => {
    const dt = world.timestep;
    for (const { body, shape, measure } of registry.values()) {
      const b = body.current;
      if (!b || !b.isDynamic() || b.isSleeping()) continue;
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 0.05) continue;
      const area = shape.area * (measure.size / shape.size) ** 2;
      // (never more than stops it)
      const impulse = Math.min(0.5 * AIR_DENSITY * shape.drag * area * speed * speed * dt, b.mass() * speed * 0.9);
      const k = -impulse / speed;
      b.applyImpulse({ x: v.x * k, y: v.y * k, z: v.z * k }, false);
    }
  });
  return null;
}

/** The scene's particles (see particles.js). */
export const particles = new ParticleSystem();

/** The particles drawn, and each frame given off by the objects that give them off, and moved on. */
export function Particles({ registry }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    scene.add(...particles.objects);
    return () => scene.remove(...particles.objects);
  }, [scene]);
  const size = new THREE.Vector2();
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    for (const e of registry.values()) {
      const b = e.body.current;
      if (!e.material.particles || !b) continue;
      _v.copy(b.translation());
      particles.emit(e.def.id, e.material, _v, e.measure.radius * 0.6, dt, (e.measure.size / CUBE_SIZE) ** 2);
    }
    // the eye's viewport height, for the particles' size on screen
    const eye = gl.xr.isPresenting ? gl.xr.getCamera().cameras[0]?.viewport : null;
    const halfHeight = eye ? eye.w / 2 : gl.getDrawingBufferSize(size).y / 2;
    particles.step(dt, halfHeight);
  });
  return null;
}

const LIGHTS = 4; // glowing objects lighting the scene at once: those nearest the viewer
const _light = new THREE.Vector3();

/** Point lights on the glowing objects (light_cd), the nearest ones to the viewer; always there, dark when unused (so shaders don't change). */
export function GlowLights({ registry }) {
  const lights = useRef([]);
  useFrame(({ camera }) => {
    camera.getWorldPosition(_light);
    const glowing = [...registry.values()]
      .filter((e) => e.material.light > 0 && e.body.current)
      .map((e) => ({ e, d: _v.copy(e.body.current.translation()).distanceToSquared(_light) }))
      .sort((a, b) => a.d - b.d);
    lights.current.forEach((light, i) => {
      if (!light) return;
      const g = glowing[i]?.e;
      light.intensity = g ? g.material.light * (g.measure.size / CUBE_SIZE) ** 2 : 0;
      if (!g) return;
      light.position.copy(g.body.current.translation());
      light.color.set(g.material.look.emissive ?? g.material.look.color);
    });
  });
  return Array.from({ length: LIGHTS }, (_, i) => <pointLight key={i} ref={(l) => (lights.current[i] = l)} intensity={0} distance={0} decay={2} />);
}

// what counts as a strike: the pair's contact impulse jumping by this much
// (as a change of speed, m/s) from the step before; a resting object's
// steady push against the floor doesn't
const IMPACT_DV = 0.12;
const IMPACT_GAP = 0.05; // s: the soonest a pair strikes again
const DISC_SIZE = Math.cbrt(Math.PI * DISC.radius ** 2 * DISC.thickness);
const _a = new THREE.Vector3();
const _n = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _r = new THREE.Vector3();
const _w = new THREE.Vector3();

/** A body's velocity at world point `p`, into `out` (none for the disc). */
function pointVelocity(b, p, out) {
  if (!b) return out.set(0, 0, 0);
  const v = b.linvel();
  const w = b.angvel();
  const c = b.translation();
  _r.set(p.x - c.x, p.y - c.y, p.z - c.z);
  return out.set(v.x, v.y, v.z).add(_w.set(w.x, w.y, w.z).cross(_r));
}

const SLIDE_BUZZ_EVERY = 0.06; // s between the buzzes of something held sliding on another
// clay: how much a strike squashes it, and how far out of shape it can go
const SQUASH_PER_MS = 0.12; // a strike at 1 m/s (beyond the first 0.3) squashes it this much along the blow
const SQUASH_MAX = 0.3; // at most this much a strike
const SQUASH_ASPECT = 5; // no longer than this many times its narrowest
const SQUASH_GAP = 0.15; // s between one object's squashes
const _m3a = new THREE.Matrix3();
const _m3b = new THREE.Matrix3();
const _nl = new THREE.Vector3();

/**
 * Something plastic (clay) struck at `speed` m/s along world `normal`: its
 * resizing squashed along the blow and spread round it (its volume kept).
 * Returns the new 3×3 (column-major), or null if it's squashed out of shape enough.
 */
function squashed(entry, normal, speed) {
  const amount = Math.min(SQUASH_MAX, entry.material.plasticity * Math.max(0, speed - 0.3) * SQUASH_PER_MS);
  if (amount < 0.01) return null;
  const s = 1 - amount;
  const w = 1 / Math.sqrt(s);
  // the blow in its own frame
  _nl.copy(normal).applyQuaternion(_qa.copy(entry.body.current.rotation()).invert()).normalize();
  const g = s - w;
  const n = _nl;
  _m3a.set(w + g * n.x * n.x, g * n.x * n.y, g * n.x * n.z, g * n.y * n.x, w + g * n.y * n.y, g * n.y * n.z, g * n.z * n.x, g * n.z * n.y, w + g * n.z * n.z);
  _m3b.identity();
  if (entry.def.transform) _m3b.fromArray(entry.def.transform);
  const t = _m3a.multiply(_m3b);
  // (how stretched: its longest axis over its shortest, roughly)
  const e = t.elements;
  const len = [0, 3, 6].map((c) => Math.hypot(e[c], e[c + 1], e[c + 2]));
  if (Math.max(...len) / Math.min(...len) > SQUASH_ASPECT) return null;
  return [...e];
}
// glue: a bond where something sticky touches, until it's pulled this far out of place
const BOND_BREAK_M = 0.01;
const BOND_BREAK_RAD = 0.35;
const REBOND_S = 0.6; // s before a pair pulled apart can stick again
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** World point `p` in `body`'s own space. */
function localPoint(body, p) {
  _qa.copy(body.rotation()).invert();
  return _p1.copy(p).sub(body.translation()).applyQuaternion(_qa).clone();
}

/**
 * After each step: what things touching do (see sound.js, particles.js). Each
 * pair in contact: a sudden rise in the impulse between them is a strike,
 * ringing both, throwing up their impact particles and wobbling the wobbly,
 * and buzzing the controller holding either, as hard as it struck; while they
 * touch, sliding hisses (and buzzes softly, held) and a ball rolling rumbles.
 * Something sticky (glue) bonds to what it touches, the disc too, with a
 * fixed joint, until pulled out of place (by a hand, say), when it lets go.
 * Something plastic (clay) is squashed where it strikes things, and stays so
 * (`onDeform(id, transform)`). Each frame the listener follows the viewer.
 * `disc`: ref to the disc's collider; `holds`: who holds what (see Holds).
 */
export function ContactSounds({ registry, disc, holds, onDeform }) {
  const { world, rapier } = useRapier();
  const pairs = useMemo(() => new Map(), []); // key -> { dv, struck, seen, unbonded }
  const bonds = useMemo(() => new Map(), []); // key -> { joint, b1, b2, a1, a2, turn (b1's rotation relative to b2's) }
  const slideBuzz = useRef({}); // hand -> when it may buzz for sliding again
  const gl = useThree((s) => s.gl);
  useAfterPhysicsStep((world) => {
    const dt = world.timestep;
    const now = performance.now() / 1000;
    // bonds pulled out of place let go (and ones whose objects went)
    for (const [key, bond] of bonds) {
      const gone = !world.bodies.contains(bond.b1.handle) || !world.bodies.contains(bond.b2.handle) || !world.impulseJoints.contains(bond.joint.handle);
      if (!gone) {
        _p1.copy(bond.a1).applyQuaternion(_qa.copy(bond.b1.rotation())).add(bond.b1.translation());
        _p2.copy(bond.a2).applyQuaternion(_qb.copy(bond.b2.rotation())).add(bond.b2.translation());
        const twist = _qa.copy(bond.b1.rotation()).premultiply(_qb.copy(bond.b2.rotation()).invert()).angleTo(bond.turn);
        if (_p1.distanceTo(_p2) < BOND_BREAK_M && twist < BOND_BREAK_RAD) continue;
        world.removeImpulseJoint(bond.joint, true);
        for (const id of bond.ids) for (const hand of holds.handsOf(id)) pulseHand(hand, 0.5, 40);
      }
      bonds.delete(key);
      const pair = pairs.get(key);
      if (pair) pair.unbonded = now;
    }
    const byHandle = new Map();
    for (const e of registry.values()) {
      const b = e.body.current;
      if (!b || !e.material.solid) continue;
      // every collider of it (a stellated shape has several)
      const info = { key: e.def.id, entry: e, body: b, material: e.material, size: e.measure.size, shape: e.def.shape };
      for (let i = 0; i < b.numColliders(); i++) {
        const c = b.collider(i);
        byHandle.set(c.handle, { ...info, collider: c });
      }
    }
    if (disc.current) byHandle.set(disc.current.handle, { key: 0, collider: disc.current, body: null, material: DISC_MATERIAL, size: DISC_SIZE });
    const done = new Set(); // (a pair touching at several colliders counts once a step)
    for (const a of byHandle.values()) {
      if (!a.body) continue;
      world.contactPairsWith(a.collider, (otherCollider) => {
        const b = byHandle.get(otherCollider.handle);
        if (!b || b.key === a.key || (b.body && b.key < a.key)) return; // (each pair once)
        const key = `${a.key}:${b.key}`;
        world.contactPair(a.collider, b.collider, (manifold) => {
          let impulse = 0;
          for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
          if (done.has(key) && impulse <= 0) return;
          const pair = pairs.get(key) ?? { dv: 0, struck: 0 };
          pairs.set(key, pair);
          pair.seen = now;
          if (impulse <= 0) {
            pair.dv = 0;
            return;
          }
          if (done.has(key)) return;
          done.add(key);
          // where they touch: the middle of the contact points
          const points = manifold.numSolverContacts();
          if (points) {
            _a.set(0, 0, 0);
            for (let i = 0; i < points; i++) {
              const p = manifold.solverContactPoint(i);
              _a.x += p.x / points;
              _a.y += p.y / points;
              _a.z += p.z / points;
            }
          } else _a.copy(a.body.translation());
          // a body held (kinematic) or the disc pushes as if it had no end of mass
          const ma = a.body.isDynamic() ? a.body.mass() : Infinity;
          const mb = b.body?.isDynamic() ? b.body.mass() : Infinity;
          if (ma === Infinity && mb === Infinity) return;
          const mass = 1 / (1 / ma + 1 / mb);
          const dv = impulse / mass;
          if (dv - pair.dv > IMPACT_DV && now - pair.struck > IMPACT_GAP) {
            pair.struck = now;
            const bounce = (a.material.restitution + b.material.restitution) / 2;
            const speed = dv / (1 + bounce);
            impact(a.material, a.size, speed, mass, _a);
            impact(b.material, b.size, speed, mass, _a);
            const blow = manifold.normal();
            for (const side of [a, b]) {
              // clay: squashed along the blow
              if (side.entry?.material.plasticity && now - (side.entry.squashedAt ?? 0) > SQUASH_GAP) {
                const t = squashed(side.entry, blow, speed);
                if (t) {
                  side.entry.squashedAt = now;
                  onDeform?.(side.key, t);
                }
              }
              particles.burst(side.material, _a, speed);
              if (side.entry?.material.jiggle) jiggle(side.entry, speed);
              // held: the hand feels it, harder the harder it struck
              if (side.body) for (const hand of holds.handsOf(side.key)) pulseHand(hand, Math.min(1, 0.2 + speed * 0.3), Math.min(80, 25 + speed * 20));
            }
          }
          pair.dv = dv;
          // something sticky touching: they bond where they touch
          if ((a.material.sticky || b.material.sticky) && !bonds.has(key) && now - (pair.unbonded ?? -Infinity) > REBOND_S) {
            const b2 = b.body ?? disc.current.parent();
            if (b2) {
              const a1 = localPoint(a.body, _a);
              const a2 = localPoint(b2, _a);
              const turn = _qa.copy(a.body.rotation()).premultiply(_qb.copy(b2.rotation()).invert()).clone();
              const joint = world.createImpulseJoint(rapier.JointData.fixed(a1, { x: 0, y: 0, z: 0, w: 1 }, a2, turn), a.body, b2, true);
              bonds.set(key, { joint, b1: a.body, b2, a1, a2, turn, ids: [a.key, b.key].filter(Boolean) });
            }
          }
          // sliding: how fast the surfaces pass each other where they touch
          const n = manifold.normal();
          _n.set(n.x, n.y, n.z);
          _rel.subVectors(pointVelocity(a.body, _a, _va), pointVelocity(b.body, _a, _vb));
          const slide = _rel.addScaledVector(_n, -_rel.dot(_n)).length();
          const spin = (body, shape) => (shape === 'sphere' && body ? _w.copy(body.angvel()).length() * SPHERE_RADIUS : 0);
          const roll = Math.max(spin(a.body, a.shape), spin(b.body, b.shape));
          scrape(key, a.material, b.material, slide, roll, impulse / dt, _a);
          // held and sliding on something: a soft buzz, stronger the faster
          if (slide > 0.05)
            for (const side of [a, b])
              if (side.body)
                for (const hand of holds.handsOf(side.key))
                  if (now >= (slideBuzz.current[hand] ?? 0)) {
                    pulseHand(hand, Math.min(0.35, 0.08 + slide * 0.15), 40);
                    slideBuzz.current[hand] = now + SLIDE_BUZZ_EVERY;
                  }
        });
      });
    }
    // forget pairs long apart
    if (pairs.size > 500) for (const [key, pair] of pairs) if (now - pair.seen > 1) pairs.delete(key);
  });
  useFrame(({ camera }) => {
    const viewer = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    viewer.updateMatrixWorld();
    setListener(viewer.matrixWorld);
    updateSounds();
  });
  return null;
}

// the labels over held and pointed-at objects: their material's name and their mass
const LABEL_FONT = '600 56px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const LABEL_H_M = 0.045; // m: the label's height in the world, at scene scale 1
const LABEL_GAP_M = 0.04; // m above the object's top
const labelTextures = new Map();
function labelTexture(text) {
  if (labelTextures.has(text)) return labelTextures.get(text);
  if (labelTextures.size > 200) {
    for (const t of labelTextures.values()) t.texture.dispose();
    labelTextures.clear();
  }
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = LABEL_FONT;
  const w = Math.ceil(ctx.measureText(text).width) + 64;
  const h = 96;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 28);
  ctx.fillStyle = 'rgba(10, 14, 28, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = LABEL_FONT;
  ctx.fillStyle = '#e8ecf2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 3);
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const entry = { texture, aspect: w / h };
  labelTextures.set(text, entry);
  return entry;
}

/** A mass as people say it: grams, kilograms or tonnes, to three figures. */
export function massText(kg) {
  const three = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
  if (kg < 1) return `${three(kg * 1000)} g`;
  if (kg < 1000) return `${three(kg)} kg`;
  return `${three(kg / 1000)} t`;
}

const LABELS = 6; // as many as can show at once: held by two grips and a pointer, pointed at by two rays and the mouse
const _at = new THREE.Vector3();

/**
 * Over each object held or pointed at (`pointed`: pointer id -> object id),
 * facing the viewer: its material's name and its mass. `viewScale()`: how much bigger
 * than life the viewer is (the scene scale's inverse), so labels look the same size.
 */
export function MaterialLabels({ registry, holds, pointed, viewScale }) {
  const sprites = useRef([]);
  const materials = useMemo(
    () => Array.from({ length: LABELS }, () => new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false })),
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    // (the viewer: the headset's camera in XR, which the scene's camera doesn't follow)
    const viewer = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    const ids = [...new Set([...holds.map.keys(), ...pointed.values()])];
    const shown = ids.map((id) => registry.get(id)).filter((e) => e?.mesh.current);
    const k = viewScale();
    sprites.current.forEach((sprite, i) => {
      if (!sprite) return;
      const entry = shown[i];
      sprite.visible = Boolean(entry);
      if (!entry) return;
      const mass = entry.body.current?.mass();
      const { texture, aspect } = labelTexture(mass ? `${entry.material.name} · ${massText(mass)}` : entry.material.name);
      if (sprite.material.map !== texture) {
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
      }
      // above the object whichever way it's turned (its bounding sphere's top)
      entry.mesh.current.getWorldPosition(_at);
      const h = LABEL_H_M * k;
      sprite.position.set(_at.x, _at.y + entry.measure.radius + LABEL_GAP_M * k + h / 2, _at.z);
      // the same size on screen however far, but never smaller than life size up close
      const far = Math.max(1, viewer.getWorldPosition(_v).distanceTo(sprite.position) / (1.2 * k));
      sprite.scale.set(h * aspect * far, h * far, 1);
    });
  });
  return materials.map((material, i) => (
    <sprite key={i} ref={(s) => (sprites.current[i] = s)} material={material} visible={false} renderOrder={1000} raycast={() => null} />
  ));
}
