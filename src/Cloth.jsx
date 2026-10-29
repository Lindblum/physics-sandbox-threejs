import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIR_DENSITY } from './materials.js';
import { CUBE_SIZE, CYLINDER, SPHERE_RADIUS, TORUS, shapeOf } from './shapes.js';
import { GROUPS, lookMaterial, onLooksChanged } from './Physics.jsx';

// Cloth: a shape made of fabric, not solid through. Its surface is a mesh of
// points, each a small ball in Rapier, each held to its neighbours by a
// thread (a rope joint: it can't stretch, but it slackens, so the fabric
// folds and crumples), and it's stuffed: a gentle pressure inside pushes out
// toward the volume it was made with, so a cloth cube is a cushion, a cloth
// ball a beanbag. It falls, squashes, sags over what's under it, and things
// land on it. The mouse (Select's left button, or the middle one) picks it up
// by the point nearest the pointer.
//
// How fine its mesh is: Physics → Cloth Detail (threads about CLOTH_EDGE apart
// at 100%; finer, more points, MAX_POINTS at most).

const CLOTH_EDGE = 0.025; // m: the threads' length at Cloth Detail 100%
const MAX_POINTS = 900;
const MASS_PER_POINT = 0.002; // kg (lighter, and things resting on it would press through)
const STUFFING = 6000; // Pa of pressure for each part of its volume it's lost (more: firmer; it settles about a tenth squashed)
const MAX_PRESSURE = 2500; // Pa
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
  if (def.grains?.length === points.length * 3) points = points.map((_, i) => new THREE.Vector3().fromArray(def.grains, i * 3));
  const sorted = [...rest].sort((a, b) => a - b);
  return { points, triangles: surface.triangles, edges, rest, radius: sorted[Math.floor(sorted.length / 2)] * 0.4, volume };
}

/** A closed mesh's volume (its triangles outward). */
function volumeOf(points, triangles) {
  let v = 0;
  for (const [a, b, c] of triangles) v += points[a].dot(_c.crossVectors(points[b], points[c])) / 6;
  return Math.abs(v);
}
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();

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
 * `pours`, `fluidGrains`: where it counts its points and gives them for
 * saving (see Fluids.jsx); `onClick(e, id)`: the tools; `grabs(e)`: whether a
 * pointer press may pick it up; `detail`: Physics → Cloth Detail.
 */
export function ClothSheet({ def, material, pours, fluidGrains, setBodies, onClick, grabs, detail }) {
  const { world, rapier } = useRapier();
  const controls = useThree((s) => s.controls);
  const mesh = useMemo(() => clothMesh(def, def.clothDetail ?? detail), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => surfaceGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const drag = useRef(null); // { body, pointerId, ray, distance }

  useEffect(() => {
    const volume = (4 / 3) * Math.PI * mesh.radius ** 3;
    const bodies = mesh.points.map((p) => {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setLinearDamping(0.4)
          .setAngularDamping(1)
          .setGravityScale(1 - AIR_DENSITY / material.density)
          .setCanSleep(true),
      );
      world.createCollider(
        rapier.ColliderDesc.ball(mesh.radius).setDensity(MASS_PER_POINT / volume).setFriction(material.friction).setRestitution(0).setCollisionGroups(GROUPS.object),
        body,
      );
      return body;
    });
    // the threads, each as long as it was made
    mesh.edges.forEach(([a, b], i) => world.createImpulseJoint(rapier.JointData.rope(mesh.rest[i], { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), bodies[a], bodies[b], true));
    const pour = { def, material, radius: mesh.radius, bodies };
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

  // the stuffing: each step, the surface pushed out (each triangle, by its area, along its normal) as far as it's lost volume
  const at = useMemo(() => mesh.points.map(() => new THREE.Vector3()), [mesh]);
  useBeforePhysicsStep((w) => {
    const pour = pours.get(def.id);
    if (!pour || pour.bodies.some((b) => b.isSleeping())) return;
    pour.bodies.forEach((b, i) => at[i].copy(b.translation()));
    const lost = 1 - volumeOf(at, mesh.triangles) / mesh.volume;
    if (lost <= 0) return;
    const pressure = Math.min(MAX_PRESSURE, STUFFING * lost);
    const dt = w.timestep;
    for (const [a, b, c] of mesh.triangles) {
      // (half the cross product: the triangle's area, along its outward normal)
      _n.crossVectors(_e1.subVectors(at[b], at[a]), _e2.subVectors(at[c], at[a])).multiplyScalar((0.5 * pressure * dt) / 3);
      for (const i of [a, b, c]) pour.bodies[i].applyImpulse(_n, false);
    }
  });

  const _p = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const pour = pours.get(def.id);
    if (!pour) return;
    const d = drag.current;
    if (d) d.body.setNextKinematicTranslation(d.ray.at(d.distance, _p));
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

  const letGo = (e) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    d.body.setBodyType(rapier.RigidBodyType.Dynamic, true);
    if (controls) controls.enabled = true;
  };

  return (
    <mesh
      geometry={geometry}
      material={clothLook(material)}
      castShadow
      receiveShadow
      frustumCulled={false}
      onClick={(e) => onClick(e, def.id)}
      onPointerDown={(e) => {
        if (!grabs(e) || drag.current) return;
        const pour = pours.get(def.id);
        if (!pour) return;
        e.stopPropagation();
        // the point nearest where it was taken, held there
        let best = null;
        for (const b of pour.bodies) {
          const dist = _p.copy(b.translation()).distanceToSquared(e.point);
          if (!best || dist < best.dist) best = { b, dist };
        }
        best.b.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
        for (const b of pour.bodies) b.wakeUp();
        drag.current = { body: best.b, pointerId: e.pointerId, ray: e.ray.clone(), distance: e.distance };
        e.target?.setPointerCapture?.(e.pointerId);
        if (controls) controls.enabled = false;
      }}
      onPointerMove={(e) => {
        if (drag.current?.pointerId === e.pointerId) drag.current.ray.copy(e.ray);
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
    />
  );
}
