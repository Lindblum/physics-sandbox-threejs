import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Things made of grains (liquids, sand: Fluids.jsx; cloth: Cloth.jsx), and
// holding them. A hand (or the mouse) takes the grains round where it took
// hold: a handful of liquid or sand, a patch of cloth. Held, they're
// kinematic and keep their places round the holder's point as it moves and
// turns; let go, they fly on at the holder's speed.

/** Every pour and cloth by its object's id: { def, material, radius (its grains'), bodies, meshes() (what's drawn, to point at) }. */
export const pours = new Map();
/** Who holds grains now, by holder ('left', 'right', 'pointer'): { id, by, bodies, offsets, point, turn0, velocity, last }. */
export const grainHolds = new Map();

const DYNAMIC = 0; // Rapier's RigidBodyType
const KINEMATIC = 2;
const HANDFUL = 0.04; // m: liquid and sand: the grains this near where it's taken (or a few grains' worth, if bigger)
const PATCH = 3; // cloth: the points within this many of its balls' radii
const MAX_TAKEN = 80;
const MAX_THROW = 10; // m/s

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Pour `id`'s grain nearest world point `p`, and how far its surface is from it: { body, distance }, or null. */
export function nearestGrain(id, p) {
  const pour = pours.get(id);
  if (!pour) return null;
  let best = null;
  for (const b of pour.bodies) {
    const d = _v.copy(b.translation()).distanceTo(p) - pour.radius;
    if (!best || d < best.distance) best = { body: b, distance: d };
  }
  return best;
}

/** The pour or cloth whose grains are nearest world point `p` (within `reach` of their surface): { id, distance }, or null. */
export function grainsNear(p, reach) {
  let best = null;
  for (const id of pours.keys()) {
    const g = nearestGrain(id, p);
    if (g && g.distance <= reach && (!best || g.distance < best.distance)) best = { id, distance: g.distance };
  }
  return best;
}

/** The meshes drawing the grains, to point at (each with userData.pourId). */
export const grainMeshes = () => [...pours.values()].flatMap((p) => p.meshes?.() ?? []).filter(Boolean);

/** `by` takes pour `id`'s grains round world point `point`, turned as `quaternion` (the holder's) is. Returns the hold, or null. */
export function takeGrains(id, by, point, quaternion = new THREE.Quaternion()) {
  const pour = pours.get(id);
  if (!pour) return null;
  releaseGrains(by);
  const reach = pour.material.simulation === 'cloth' || pour.material.simulation === 'soft' ? pour.radius * PATCH : Math.max(HANDFUL, pour.radius * 4);
  let taken = pour.bodies
    .filter((b) => !b.isKinematic())
    .map((b) => ({ b, d: _v.copy(b.translation()).distanceTo(point) }))
    .filter((x) => x.d <= reach + pour.radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_TAKEN)
    .map((x) => x.b);
  if (!taken.length) {
    const nearest = nearestGrain(id, point);
    if (!nearest || nearest.body.isKinematic()) return null;
    taken = [nearest.body];
  }
  for (const b of pour.bodies) b.wakeUp();
  const inverse = quaternion.clone().invert();
  const hold = {
    id,
    by,
    bodies: taken,
    offsets: taken.map((b) => new THREE.Vector3().copy(b.translation()).sub(point).applyQuaternion(inverse)),
    point: point.clone(),
    turn: quaternion.clone(),
    velocity: new THREE.Vector3(),
    last: null,
  };
  for (const b of taken) b.setBodyType(KINEMATIC, true);
  grainHolds.set(by, hold);
  return hold;
}

/** `by`'s held grains to world point `point`, turned as `quaternion`, over `dt` seconds (their velocity followed, for the throw). */
export function moveGrains(by, point, quaternion, dt) {
  const hold = grainHolds.get(by);
  if (!hold) return;
  if (!pours.has(hold.id)) {
    grainHolds.delete(by); // (its pour went)
    return;
  }
  if (quaternion) hold.turn.copy(quaternion);
  if (hold.last && dt > 0) hold.velocity.lerp(_v.subVectors(point, hold.last).divideScalar(dt), 0.5);
  hold.last = (hold.last ?? new THREE.Vector3()).copy(point);
  hold.point.copy(point);
  hold.bodies.forEach((b, i) => b.setNextKinematicTranslation(_v.copy(hold.offsets[i]).applyQuaternion(_q.copy(hold.turn)).add(point)));
}

/** `by` lets go: its grains fly on at the speed they were moving. */
export function releaseGrains(by) {
  const hold = grainHolds.get(by);
  grainHolds.delete(by);
  if (!hold || !pours.has(hold.id)) return;
  const v = hold.velocity.clampLength(0, MAX_THROW);
  for (const b of hold.bodies) {
    b.setBodyType(DYNAMIC, true);
    b.setLinvel(v, true);
  }
}

/** Pour `id`'s total mass, kg. */
export const pourMass = (id) => pours.get(id)?.bodies.reduce((m, b) => m + b.mass(), 0) ?? 0;

/** Where pour `id` is: the middle of its grains (into `out`). */
export function pourCentre(id, out) {
  const pour = pours.get(id);
  out.set(0, 0, 0);
  if (!pour?.bodies.length) return out;
  for (const b of pour.bodies) out.add(b.translation());
  return out.divideScalar(pour.bodies.length);
}

const POINTER = 'pointer'; // (the mouse's hold, as Holds calls it)

/**
 * Pointer handlers for pour `id`'s drawn meshes: over it, it's in `pointed`
 * (pointer id -> its id, for its label); a press `grabs(e)` allows takes a
 * handful (a patch of cloth) and carries it along the pointer's ray, at the
 * distance it was taken from; let go, it's thrown.
 */
export function useGrainPointer(id, grabs, pointed) {
  const controls = useThree((s) => s.controls);
  const drag = useRef(null); // { pointerId, ray, distance }
  useFrame((_, delta) => {
    const d = drag.current;
    if (!d) return;
    if (!grainHolds.has(POINTER)) {
      drag.current = null;
      if (controls) controls.enabled = true;
      return;
    }
    moveGrains(POINTER, d.ray.at(d.distance, _v.clone()), null, Math.min(delta, 0.1));
  });
  const letGo = (e) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    releaseGrains(POINTER);
    if (controls) controls.enabled = true;
  };
  return {
    onPointerDown: (e) => {
      if (!grabs?.(e) || drag.current) return;
      e.stopPropagation();
      if (!takeGrains(id, POINTER, e.point)) return;
      drag.current = { pointerId: e.pointerId, ray: e.ray.clone(), distance: e.distance };
      e.target?.setPointerCapture?.(e.pointerId);
      if (controls) controls.enabled = false;
    },
    onPointerMove: (e) => {
      if (drag.current?.pointerId === e.pointerId) drag.current.ray.copy(e.ray);
    },
    onPointerUp: letGo,
    onPointerCancel: letGo,
    onPointerOver: (e) => {
      if (e.internalPointer && e.pointerType !== 'ray') return;
      e.stopPropagation(); // (what's in front is what's pointed at: not the object behind it too)
      pointed?.set(e.pointerId, id);
    },
    onPointerOut: (e) => {
      if (pointed?.get(e.pointerId) === id) pointed.delete(e.pointerId);
    },
  };
}
