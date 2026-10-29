import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIR_DENSITY } from './materials.js';
import { CUBE_SIZE, CYLINDER, SPHERE_RADIUS, TORUS, shapeOf } from './shapes.js';
import { GROUPS, lookMaterial, onLooksChanged } from './Physics.jsx';
import { pours, useGrainPointer } from './grains.js';

// Cloth and soft bodies: shapes whose surface is a mesh of points, each a
// small ball in Rapier, each held to its neighbours by a thread (a rope joint:
// it can't stretch, but it slackens, so the surface folds and crumples).
// What else holds them in shape:
//
//   shape matching   (both) each step, the points' rest shape is fitted to
//                    where they are now (moved and turned as they have), and
//                    each point is pulled part of the way back to its place in
//                    it, by the material's soft_stiffness: things pressing on
//                    it dent it, and it springs back; a plastic one (clay)
//                    takes the dents into its rest shape, and keeps them
//   stuffing         (cloth) a gentle pressure inside pushes out toward the
//                    volume it was made with: a cloth cube is a cushion, a ball
//                    a beanbag; its shape matching is slight, so it slumps and folds
//
// A soft body weighs what the solid would; cloth what its fabric does. A
// hand, or the mouse (Select's left button, or the middle one), picks one up
// by a patch round where it's taken (see grains.js).
//
// How fine its mesh is: Physics → Cloth Detail (threads about CLOTH_EDGE apart
// at 100%; finer, more points, MAX_POINTS at most).

const CLOTH_EDGE = 0.025; // m: the threads' length at Cloth Detail 100%
const MAX_POINTS = 900;
const MASS_PER_POINT = 0.002; // kg (lighter, and things resting on it would press through)
const STUFFING = 3000; // Pa of pressure for each part of its volume it's lost (more: firmer)
const MAX_PRESSURE = 1500; // Pa
const DAMPING = { cloth: 1.5, soft: 0.5 }; // per second: how quickly its wobbling dies down (unless its material's damping says)
const YIELD = 0.01; // m: a plastic soft body pushed further than this out of shape keeps part of it (its own weight sags it less)
const SET = 0.3; // ...this much of it, each step
const FALLEN_Y = -10;

const looks = new Map();
onLooksChanged(() => {
  for (const look of looks.values()) look.dispose();
  looks.clear();
});
/** The material's look, both sides showing (a squashed shell shows its inside). */
function clothLook(material) {
  if (!looks.has(material.id)) {
    const look = lookMaterial(material);
    look.side = THREE.DoubleSide;
    looks.set(material.id, look);
  }
  return looks.get(material.id);
}

/** A shape's surface, coarse, as points (merged) and triangles (outward), to subdivide. */
function baseSurface(id) {
  const coarse = {
    cube: () => new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
    sphere: () => new THREE.IcosahedronGeometry(SPHERE_RADIUS, 1),
    cylinder: () => new THREE.CylinderGeometry(CYLINDER.radius, CYLINDER.radius, CYLINDER.height, 12, 1),
    torus: () => new THREE.TorusGeometry(TORUS.radius, TORUS.tube, 6, 16).rotateX(Math.PI / 2),
  }[id];
  const g = coarse ? coarse() : shapeOf(id).geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  const merged = mergeVertices(g, 1e-5);
  const pos = merged.getAttribute('position');
  const points = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i));
  const index = merged.getIndex().array;
  const triangles = [];
  for (let i = 0; i < index.length; i += 3) if (index[i] !== index[i + 1] && index[i + 1] !== index[i + 2] && index[i] !== index[i + 2]) triangles.push([index[i], index[i + 1], index[i + 2]]);
  return { points, triangles };
}

/** Each triangle split in four at its edges' midpoints (shared between neighbours). */
function subdivide({ points, triangles }) {
  const mids = new Map();
  const mid = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!mids.has(key)) {
      mids.set(key, points.length);
      points.push(points[a].clone().add(points[b]).multiplyScalar(0.5));
    }
    return mids.get(key);
  };
  const next = [];
  for (const [a, b, c] of triangles) {
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { points, triangles: next };
}

const edgesOf = (triangles) => {
  const edges = new Map();
  for (const [a, b, c] of triangles)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      edges.set(p < q ? `${p}_${q}` : `${q}_${p}`, [Math.min(p, q), Math.max(p, q)]);
  return [...edges.values()];
};

/**
 * The cloth's mesh: its shape's surface (resized by `def.transform`),
 * subdivided until its threads are about CLOTH_EDGE / `detail` long, placed
 * and turned as made: { points (world), triangles, edges, rest (each edge's
 * length), radius (its balls'), volume (its stuffing's) }. From a saved scene,
 * its points as they were, if the mesh is the same.
 */
export function clothMesh(def, detail) {
  const t = def.transform ? new THREE.Matrix3().fromArray(def.transform) : null;
  let surface = baseSurface(def.shape);
  if (t) for (const p of surface.points) p.applyMatrix3(t);
  const longest = (s) => Math.max(...edgesOf(s.triangles).map(([a, b]) => s.points[a].distanceTo(s.points[b])));
  while (longest(surface) > CLOTH_EDGE / detail && surface.points.length * 4 <= MAX_POINTS) surface = subdivide(surface);
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation));
  const at = new THREE.Vector3(...def.position);
  let points = surface.points.map((p) => p.clone().applyQuaternion(turn).add(at));
  const edges = edgesOf(surface.triangles);
  const rest = edges.map(([a, b]) => points[a].distanceTo(points[b]));
  const volume = volumeOf(points, surface.triangles);
  // its rest shape, round its middle (for shape matching), as made
  const centre = points.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(points.length);
  const shape = points.map((p) => p.clone().sub(centre));
  if (def.grains?.length === points.length * 3) points = points.map((_, i) => new THREE.Vector3().fromArray(def.grains, i * 3));
  const sorted = [...rest].sort((a, b) => a - b);
  return { points, triangles: surface.triangles, edges, rest, radius: sorted[Math.floor(sorted.length / 2)] * 0.4, volume, shape };
}

/** A closed mesh's volume (its triangles outward). */
function volumeOf(points, triangles) {
  let v = 0;
  for (const [a, b, c] of triangles) v += points[a].dot(_c.crossVectors(points[b], points[c])) / 6;
  return Math.abs(v);
}
const _c = new THREE.Vector3();
const _g = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * The turn that best fits rest shape `shape` (points round its middle) to
 * `points` (round `centre`): the rotation part of Σ (p - centre) qᵀ, by
 * polar decomposition (averaging it with its inverse transposed until it
 * settles). `last`: the previous step's, kept if this one can't be found (squashed flat).
 */
function rotationFitting(points, shape, centre, last) {
  const a = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const e = a.elements; // (column-major: e[col * 3 + row])
  points.forEach((p, i) => {
    const px = p.x - centre.x;
    const py = p.y - centre.y;
    const pz = p.z - centre.z;
    const q = shape[i];
    e[0] += px * q.x; e[3] += px * q.y; e[6] += px * q.z;
    e[1] += py * q.x; e[4] += py * q.y; e[7] += py * q.z;
    e[2] += pz * q.x; e[5] += pz * q.y; e[8] += pz * q.z;
  });
  if (Math.abs(a.determinant()) < 1e-12) return last;
  const r = a.clone();
  const inv = new THREE.Matrix3();
  for (let k = 0; k < 12; k++) {
    inv.copy(r).invert().transpose();
    for (let j = 0; j < 9; j++) r.elements[j] = 0.5 * (r.elements[j] + inv.elements[j]);
  }
  return r.determinant() > 0 ? r : last;
}

/** The cloth's surface for drawing: its triangles, UVs in metres (each point mapped from the plane its surface faces most). */
function surfaceGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(mesh.points.length * 3);
  mesh.points.forEach((p, i) => p.toArray(pos, i * 3));
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(mesh.triangles.flat());
  g.computeVertexNormals();
  const normal = g.getAttribute('normal');
  const uv = new Float32Array(mesh.points.length * 2);
  mesh.points.forEach((p, i) => {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    const [s, t] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y];
    uv[i * 2] = s;
    uv[i * 2 + 1] = t;
  });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * One cloth object (`def`, made of a cloth material): its points and threads
 * made in the world (and taken out after), stuffed, drawn as one surface.
 * `fluidGrains`: where it gives its points for saving (see Fluids.jsx);
 * `onClick(e, id)`: the tools; `grabs(e)`: whether a pointer press may pick
 * it up; `pointed`: pointer id -> object id (for labels); `detail`: Physics → Cloth Detail.
 */
export function ClothSheet({ def, material, fluidGrains, setBodies, onClick, grabs, pointed, detail }) {
  const { world, rapier } = useRapier();
  const drawn = useRef(null);
  const mesh = useMemo(() => clothMesh(def, def.clothDetail ?? detail), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => surfaceGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const soft = material.simulation === 'soft';
  useEffect(() => {
    const volume = (4 / 3) * Math.PI * mesh.radius ** 3;
    // (a soft body: the solid's mass shared among its points; cloth: its fabric's)
    const mass = soft ? (material.density * mesh.volume) / mesh.points.length : MASS_PER_POINT;
    const bodies = mesh.points.map((p) => {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setLinearDamping(material.damping || (DAMPING[material.simulation] ?? 0.5))
          .setAngularDamping(1)
          .setGravityScale(1 - AIR_DENSITY / material.density)
          .setCanSleep(true),
      );
      world.createCollider(
        rapier.ColliderDesc.ball(mesh.radius)
          .setDensity(mass / volume)
          .setFriction(material.friction)
          .setRestitution(soft ? material.restitution : 0)
          .setCollisionGroups(GROUPS.object),
        body,
      );
      return body;
    });
    // the threads, each as long as it was made
    mesh.edges.forEach(([a, b], i) => world.createImpulseJoint(rapier.JointData.rope(mesh.rest[i], { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), bodies[a], bodies[b], true));
    const pour = { def, material, radius: mesh.radius, bodies, meshes: () => [drawn.current] };
    pours.set(def.id, pour);
    fluidGrains.set(def.id, {
      material,
      radius: mesh.radius,
      detail: def.clothDetail ?? detail,
      positions: () => pour.bodies.flatMap((b) => Object.values(b.translation())),
      surface: () => geometry.clone(),
    });
    return () => {
      pours.delete(def.id);
      fluidGrains.delete(def.id);
      for (const b of pour.bodies) if (world.bodies.contains(b.handle)) world.removeRigidBody(b);
    };
  }, [world, rapier]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = useMemo(() => mesh.points.map(() => new THREE.Vector3()), [mesh]);
  const fit = useRef(new THREE.Matrix3()); // its rest shape's turn, last step
  useBeforePhysicsStep((w) => {
    const pour = pours.get(def.id);
    if (!pour || pour.bodies.every((b) => b.isSleeping())) return;
    const bodies = pour.bodies;
    bodies.forEach((b, i) => at[i].copy(b.translation()));
    const dt = w.timestep;
    // the stuffing (cloth): the surface pushed out (each triangle, by its area, along its normal) as far as it's lost volume
    const lost = soft ? 0 : 1 - volumeOf(at, mesh.triangles) / mesh.volume;
    if (lost > 0) {
      const pressure = Math.min(MAX_PRESSURE, STUFFING * lost);
      for (const [a, b, c] of mesh.triangles) {
        // (half the cross product: the triangle's area, along its outward normal)
        _n.crossVectors(_e1.subVectors(at[b], at[a]), _e2.subVectors(at[c], at[a])).multiplyScalar((0.5 * pressure * dt) / 3);
        for (const i of [a, b, c]) if (!bodies[i].isKinematic()) bodies[i].applyImpulse(_n, false);
      }
    }
    // shape matching: its rest shape fitted to where its points are, each pulled toward its place in it
    const stiffness = material.softStiffness;
    if (!stiffness) return;
    const alpha = 1 - (1 - stiffness) ** (dt * 60); // (the same pull a second, whatever the physics rate)
    const centre = _c.set(0, 0, 0);
    for (const p of at) centre.add(p);
    centre.divideScalar(at.length);
    const turn = rotationFitting(at, mesh.shape, centre, fit.current);
    fit.current.copy(turn);
    const back = _m.copy(turn).transpose();
    bodies.forEach((b, i) => {
      // where it should be: its place in the rest shape, turned and moved as the whole is
      _g.copy(mesh.shape[i]).applyMatrix3(turn).add(centre);
      if (material.plasticity) {
        // pushed far enough out of shape, a plastic one keeps part of it
        _d.subVectors(at[i], centre).applyMatrix3(back).sub(mesh.shape[i]);
        const over = _d.length() - YIELD;
        if (over > 0) mesh.shape[i].addScaledVector(_d, (material.plasticity * SET * over) / (over + YIELD));
      }
      if (b.isKinematic()) return;
      const v = b.linvel();
      _g.sub(at[i]).multiplyScalar(alpha / dt);
      b.setLinvel({ x: v.x + _g.x, y: v.y + _g.y, z: v.z + _g.z }, false);
    });
  });

  useFrame(() => {
    const pour = pours.get(def.id);
    if (!pour) return;
    // (one fallen off the disc: it all goes)
    if (pour.bodies.some((b) => b.translation().y < FALLEN_Y)) {
      setBodies((list) => list.filter((b) => b.id !== def.id));
      return;
    }
    const pos = geometry.getAttribute('position');
    pour.bodies.forEach((b, i) => {
      const t = b.translation();
      pos.setXYZ(i, t.x, t.y, t.z);
    });
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  });

  const handlers = useGrainPointer(def.id, grabs, pointed);
  return (
    <mesh
      ref={drawn}
      userData={{ pourId: def.id }}
      geometry={geometry}
      material={clothLook(material)}
      castShadow
      receiveShadow
      frustumCulled={false}
      {...handlers}
      onClick={(e) => onClick(e, def.id)}
    />
  );
}
