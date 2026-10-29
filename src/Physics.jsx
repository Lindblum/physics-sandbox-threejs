import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BallCollider, CoefficientCombineRule, CuboidCollider, CylinderCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep } from '@react-three/rapier';
import * as THREE from 'three';
import { AIR_DENSITY, DISC_MATERIAL, STARTING_MATERIALS, materialById } from './materials.js';
import { impact, scrape, setListener, updateSounds } from './sound.js';

// The sandbox: a solid disc for a floor, fixed in place (gravity doesn't move
// it and it can't be picked up), and the objects on it, each a solid cube or
// sphere of one material (see materials.js), with its mass, friction and
// bounce. To start with, ten cubes, one of each of ten materials, dropped from
// 10 cm above the disc at random places on it. An object that falls off the
// disc (or floats away) goes: one of the first ten comes back above the disc,
// one made since is gone.
//
// Everything moves through air (the materials table's): it drags on them
// (more on light, broad things) and buoys them up, so a gas lighter than air
// rises. Gases don't collide with anything. Where things strike or slide on
// each other they sound like what they're made of (see sound.js).
//
// An object held (by a grip, or dragged with the Select tool) is kinematic: it
// goes where the hand puts it, shoving others aside, and let go it carries on
// at the hand's last velocity and spin, so it can be thrown (see Holds).

export const DISC = { radius: 1, thickness: 0.1 }; // m; its top is the floor, y = 0
export const CUBE_SIZE = 0.1; // m along an edge
export const SPHERE_RADIUS = 0.05; // m
const SPAWN_DROP = 0.1; // m: the first cubes start this far above the disc
const SPAWN_REACH = DISC.radius - 0.15; // m from the centre: where they may start
const SPAWN_APART = 0.17; // m between their centres at least
const FALLEN_Y = -10; // m: below this an object has fallen off for good
const FLOWN_Y = 30; // m: above this one has floated away for good
const DRAG = { cube: 1.05, sphere: 0.47 }; // drag coefficients
const AREA = { cube: CUBE_SIZE ** 2, sphere: Math.PI * SPHERE_RADIUS ** 2 }; // m², facing the air
/** m: an object's size for its sound, the cube root of its volume */
const SOUND_SIZE = { cube: CUBE_SIZE, sphere: Math.cbrt((4 / 3) * Math.PI * SPHERE_RADIUS ** 3) };
const MAX_MADE = 100; // objects made with the Cube and Sphere tools at once (the oldest goes)
const MAX_THROW = 25; // m/s: the fastest a let-go object flies
const MAX_SPIN = 30; // rad/s

const DYNAMIC = 0; // Rapier's RigidBodyType
const KINEMATIC = 2; // (KinematicPositionBased)

let nextId = 1;
const halfHeight = (shape) => (shape === 'cube' ? CUBE_SIZE / 2 : SPHERE_RADIUS);

/**
 * A new object: { id, shape ('cube' | 'sphere'), material (id), position,
 * rotation (Euler XYZ), start (one of the first ten), linvel?, angvel? }.
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
  return makeBody(def.shape, def.material, [r * Math.cos(a), halfHeight(def.shape) + SPAWN_DROP, r * Math.sin(a)], undefined, true);
}

/** Bodies after `made` is added: the oldest made ones go past MAX_MADE. */
export function withMade(bodies, made) {
  const next = [...bodies, made];
  const madeCount = next.filter((b) => !b.start).length;
  if (madeCount <= MAX_MADE) return next;
  const oldest = next.find((b) => !b.start);
  return next.filter((b) => b !== oldest);
}

// shared, one per shape and per material
const GEOMETRY = {
  cube: new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
  sphere: new THREE.SphereGeometry(SPHERE_RADIUS, 32, 20),
};
const LOOKS = new Map();
function lookOf(material) {
  if (!LOOKS.has(material.id)) {
    LOOKS.set(material.id, lookMaterial(material));
  }
  return LOOKS.get(material.id);
}

/**
 * A material's look as a three.js material. `transmission`: see-through as
 * glass is, refracting by its ior (for the exported scene; on screen the
 * table's opacity stands in for it, being far cheaper, in XR most of all).
 */
export function lookMaterial(material, transmission = false) {
  const { color, roughness, metalness, opacity, ior, sheen, clearcoat } = material.look;
  const transparent = opacity < 1;
  const look = new THREE.MeshPhysicalMaterial({ name: material.name, color, roughness, metalness, ior: Math.min(2.333, Math.max(1, ior)), sheen, clearcoat });
  if (sheen) look.sheenColor.set(color);
  if (transmission && material.look.transmission > 0) look.transmission = material.look.transmission;
  else if (transparent) Object.assign(look, { transparent, opacity, depthWrite: false });
  return look;
}

/**
 * Who holds which objects: a grip ('left' / 'right') or a dragging pointer.
 * Each frame the held ones are moved where they were last put (kinematically),
 * and their velocity and spin are followed, so letting go throws them.
 * `registry`: id -> { body (ref to the Rapier body), collider (ref), mesh (ref), def, material }.
 */
export class Holds {
  constructor(registry) {
    this.registry = registry;
    this.map = new Map(); // id -> { by, position, quaternion, last?, velocity, spin }
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

  /** `by` lets go of `id`: it flies on at the velocity and spin it had. */
  release(id, by) {
    const h = this.map.get(id);
    if (!h || h.by !== by) return;
    this.map.delete(id);
    const body = this.registry.get(id)?.body.current;
    if (!body) return;
    body.setBodyType(DYNAMIC, true);
    body.setLinvel(h.velocity.clampLength(0, MAX_THROW), true);
    body.setAngvel(h.spin.clampLength(0, MAX_SPIN), true);
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
 * `onClick`; `colliderRef` gets its collider. Its friction is high, so each
 * object's own decides how it slides on it.
 */
export function Disc({ onClick, colliderRef }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, -DISC.thickness / 2, 0]}>
      <CylinderCollider ref={colliderRef} args={[DISC.thickness / 2, DISC.radius]} friction={1} restitution={0.3} />
      <mesh receiveShadow onClick={onClick} material={lookOf(DISC_MATERIAL)}>
        <cylinderGeometry args={[DISC.radius, DISC.radius, DISC.thickness, 96]} />
      </mesh>
    </RigidBody>
  );
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
  useEffect(() => {
    registry.set(def.id, { body, collider, mesh, def, material });
    return () => registry.delete(def.id);
  }, [registry, def, material]);
  const surface = {
    ref: collider,
    friction: material.friction,
    restitution: material.restitution,
    frictionCombineRule: CoefficientCombineRule.Min,
    restitutionCombineRule: CoefficientCombineRule.Average,
    density: material.density,
    sensor: material.state === 'gas', // (a gas passes through things)
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
      // buoyancy: the air it pushes aside holds it up (a gas lighter than air rises)
      gravityScale={1 - AIR_DENSITY / material.density}
      canSleep
    >
      {def.shape === 'cube' ? (
        <CuboidCollider args={[CUBE_SIZE / 2, CUBE_SIZE / 2, CUBE_SIZE / 2]} {...surface} />
      ) : (
        <BallCollider args={[SPHERE_RADIUS]} {...surface} />
      )}
      <mesh ref={mesh} geometry={GEOMETRY[def.shape]} material={lookOf(material)} castShadow receiveShadow userData={{ bodyId: def.id }} {...handlers(def.id)} />
    </RigidBody>
  );
}

/**
 * The objects, and each frame: the held ones moved (see Holds), and any that
 * fell off the disc taken away or, the first ten, put back above it.
 * `setBodies` updates the list.
 */
export function SandboxBodies({ bodies, setBodies, registry, holds, handlers }) {
  useFrame((_, delta) => {
    holds.step(Math.min(delta, 0.1));
    let fallen = null;
    for (const [id, { body }] of registry) {
      const b = body.current;
      const y = b?.translation().y;
      if (y < FALLEN_Y || y > FLOWN_Y) (fallen ??= new Set()).add(id);
    }
    if (!fallen) return;
    for (const id of fallen) registry.delete(id); // (not again next frame, before React catches up)
    setBodies((list) => list.flatMap((b) => (!fallen.has(b.id) ? [b] : b.start ? [respawned(b)] : [])));
  });
  return bodies.map((def) => <SandboxBody key={def.id} def={def} registry={registry} handlers={handlers} />);
}

/** Before each step: the air drags on each moving object (½ ρ C A v², against its motion). */
export function AirDrag({ registry }) {
  useBeforePhysicsStep((world) => {
    const dt = world.timestep;
    for (const { body, def } of registry.values()) {
      const b = body.current;
      if (!b || !b.isDynamic() || b.isSleeping()) continue;
      const v = b.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 0.05) continue;
      // (never more than stops it)
      const impulse = Math.min(0.5 * AIR_DENSITY * DRAG[def.shape] * AREA[def.shape] * speed * speed * dt, b.mass() * speed * 0.9);
      const k = -impulse / speed;
      b.applyImpulse({ x: v.x * k, y: v.y * k, z: v.z * k }, false);
    }
  });
  return null;
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

/**
 * After each step: the sounds of things touching (see sound.js). Each pair in
 * contact: a sudden rise in the impulse between them is a strike, ringing
 * both; while they touch, sliding hisses and a ball rolling rumbles. Each
 * frame the listener follows the viewer. `disc`: ref to the disc's collider.
 */
export function ContactSounds({ registry, disc }) {
  const pairs = useMemo(() => new Map(), []); // key -> { dv, struck, seen }
  const gl = useThree((s) => s.gl);
  useAfterPhysicsStep((world) => {
    const dt = world.timestep;
    const now = performance.now() / 1000;
    const byHandle = new Map();
    for (const e of registry.values()) {
      const c = e.collider.current;
      const b = e.body.current;
      if (c && b && e.material.state !== 'gas') byHandle.set(c.handle, { key: e.def.id, collider: c, body: b, material: e.material, size: SOUND_SIZE[e.def.shape], shape: e.def.shape });
    }
    if (disc.current) byHandle.set(disc.current.handle, { key: 0, collider: disc.current, body: null, material: DISC_MATERIAL, size: DISC_SIZE });
    for (const a of byHandle.values()) {
      if (!a.body) continue;
      world.contactPairsWith(a.collider, (otherCollider) => {
        const b = byHandle.get(otherCollider.handle);
        if (!b || (b.body && b.key < a.key)) return; // (each pair once)
        world.contactPair(a.collider, b.collider, (manifold) => {
          let impulse = 0;
          for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
          const key = `${a.key}:${b.key}`;
          const pair = pairs.get(key) ?? { dv: 0, struck: 0 };
          pairs.set(key, pair);
          pair.seen = now;
          if (impulse <= 0) {
            pair.dv = 0;
            return;
          }
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
          }
          pair.dv = dv;
          // sliding: how fast the surfaces pass each other where they touch
          const n = manifold.normal();
          _n.set(n.x, n.y, n.z);
          _rel.subVectors(pointVelocity(a.body, _a, _va), pointVelocity(b.body, _a, _vb));
          const slide = _rel.addScaledVector(_n, -_rel.dot(_n)).length();
          const spin = (body, shape) => (shape === 'sphere' && body ? _w.copy(body.angvel()).length() * SPHERE_RADIUS : 0);
          const roll = Math.max(spin(a.body, a.shape), spin(b.body, b.shape));
          scrape(key, a.material, b.material, slide, roll, impulse / dt, _a);
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

// the labels over held objects: their material's name
const LABEL_FONT = '600 56px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const LABEL_H_M = 0.045; // m: the label's height in the world
const LABEL_GAP_M = 0.04; // m above the object's top
const labelTextures = new Map();
function labelTexture(text) {
  if (labelTextures.has(text)) return labelTextures.get(text);
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

const LABELS = 3; // as many as can hold at once: two grips and a pointer
const _at = new THREE.Vector3();

/** Over each held object, facing the viewer: its material's name. */
export function HeldLabels({ registry, holds }) {
  const sprites = useRef([]);
  const materials = useMemo(
    () => Array.from({ length: LABELS }, () => new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false })),
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const held = [...holds.map.keys()].map((id) => registry.get(id)).filter((e) => e?.mesh.current);
    sprites.current.forEach((sprite, i) => {
      if (!sprite) return;
      const entry = held[i];
      sprite.visible = Boolean(entry);
      if (!entry) return;
      const { def } = entry;
      const { texture, aspect } = labelTexture(materialById(def.material).name);
      if (sprite.material.map !== texture) {
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
      }
      // above the object whichever way it's turned (its bounding sphere's top)
      const m = entry.mesh.current;
      m.getWorldPosition(_at);
      const reach = def.shape === 'cube' ? (CUBE_SIZE * Math.sqrt(3)) / 2 : SPHERE_RADIUS;
      sprite.position.set(_at.x, _at.y + reach + LABEL_GAP_M + LABEL_H_M / 2, _at.z);
      // the same size on screen however far, but never smaller than life size up close
      const far = Math.max(1, camera.getWorldPosition(_v).distanceTo(sprite.position) / 1.2);
      sprite.scale.set(LABEL_H_M * aspect * far, LABEL_H_M * far, 1);
    });
  });
  return materials.map((material, i) => (
    <sprite key={i} ref={(s) => (sprites.current[i] = s)} material={material} visible={false} renderOrder={1000} raycast={() => null} />
  ));
}
