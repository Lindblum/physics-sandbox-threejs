import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BallCollider, CoefficientCombineRule, CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { MATERIALS, materialById } from './materials.js';

// The sandbox: a solid disc for a floor, fixed in place (gravity doesn't move
// it and it can't be picked up), and the objects on it, each a solid cube or
// sphere of one material (see materials.js), with its mass, friction and
// bounce. To start with, ten cubes, one of each material, dropped from 10 cm
// above the disc at random places on it. An object that falls off the disc
// goes: one of the first ten comes back above the disc, one made since is gone.
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
const MAX_MADE = 100; // objects made with the Cube and Sphere tools at once (the oldest goes)
const MAX_THROW = 25; // m/s: the fastest a let-go object flies
const MAX_SPIN = 30; // rad/s

const DYNAMIC = 0; // Rapier's RigidBodyType
const KINEMATIC = 2; // (KinematicPositionBased)

let nextId = 1;
const halfHeight = (shape) => (shape === 'cube' ? CUBE_SIZE / 2 : SPHERE_RADIUS);

/** A new object: { id, shape ('cube' | 'sphere'), material (id), position, rotation, start (one of the first ten) }. */
export function makeBody(shape, material, position, rotation = [0, Math.random() * Math.PI * 2, 0], start = false) {
  return { id: nextId++, shape, material, position, rotation, start };
}

/** The first ten: a cube of each material, at random places on the disc, apart from each other. */
export function startingBodies() {
  const placed = [];
  return MATERIALS.map((material) => {
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
    const { color, roughness = 0.5, metalness = 0, transparent = false, opacity = 1 } = material.look;
    LOOKS.set(material.id, new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent, opacity, depthWrite: !transparent }));
  }
  return LOOKS.get(material.id);
}

/**
 * Who holds which objects: a grip ('left' / 'right') or a dragging pointer.
 * Each frame the held ones are moved where they were last put (kinematically),
 * and their velocity and spin are followed, so letting go throws them.
 * `registry`: id -> { body (ref to the Rapier body), mesh (ref), def }.
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

/** The floor: a fixed disc, its top at y = 0. Clicks on it reach `onClick`. */
export function Disc({ onClick }) {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, -DISC.thickness / 2, 0]}>
      <CylinderCollider args={[DISC.thickness / 2, DISC.radius]} friction={1} restitution={0.3} />
      <mesh receiveShadow onClick={onClick}>
        <cylinderGeometry args={[DISC.radius, DISC.radius, DISC.thickness, 96]} />
        <meshStandardMaterial color="#5b6170" roughness={0.8} metalness={0.1} />
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
  const mesh = useRef(null);
  const material = materialById(def.material);
  useEffect(() => {
    registry.set(def.id, { body, mesh, def });
    return () => registry.delete(def.id);
  }, [registry, def]);
  const surface = {
    friction: material.friction,
    restitution: material.restitution,
    frictionCombineRule: CoefficientCombineRule.Min,
    restitutionCombineRule: CoefficientCombineRule.Average,
    density: material.density,
  };
  return (
    <RigidBody ref={body} colliders={false} position={def.position} rotation={def.rotation} canSleep>
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
      if (b && b.translation().y < FALLEN_Y) (fallen ??= new Set()).add(id);
    }
    if (!fallen) return;
    for (const id of fallen) registry.delete(id); // (not again next frame, before React catches up)
    setBodies((list) => list.flatMap((b) => (!fallen.has(b.id) ? [b] : b.start ? [respawned(b)] : [])));
  });
  return bodies.map((def) => <SandboxBody key={def.id} def={def} registry={registry} handlers={handlers} />);
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
