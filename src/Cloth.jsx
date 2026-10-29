import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { AIR_DENSITY } from './materials.js';
import { shapeOf } from './shapes.js';
import { GROUPS, lookMaterial, onLooksChanged } from './Physics.jsx';

// Cloth: a sheet, not a solid. A square grid of points, each a small ball in
// Rapier, each held to its neighbours (along the weave) by a thread, a rope
// joint: it can't stretch, but it slackens, so the sheet folds and crumples
// freely. It falls, drapes over what's under it, and things land on it. The
// mouse (Select's left button, or the middle one) picks it up by the point
// nearest the pointer. The tool's shape sets only its size: four times the
// shape's across, about 40 cm for a cube.

const MASS_PER_POINT = 0.005; // kg: a heavy cotton's worth of sheet each (lighter, and things resting on it would press through)
const DRAPE_SIZE = 4; // the sheet, this many times the shape's size across
const SIDE = { min: 0.2, max: 1.2 }; // m
const FALLEN_Y = -10;
const DRAG = 'cloth'; // (who holds a point: the mouse)

const looks = new Map();
onLooksChanged(() => {
  for (const look of looks.values()) look.dispose();
  looks.clear();
});
/** The material's look, both sides showing. */
function clothLook(material) {
  if (!looks.has(material.id)) {
    const look = lookMaterial(material);
    look.side = THREE.DoubleSide;
    looks.set(material.id, look);
  }
  return looks.get(material.id);
}

/** Where the sheet's points start (from a saved scene, or laid out flat, turned as made) and how far apart: { n (a side), spacing, points }. */
function sheetPoints(def, material) {
  if (def.grains) {
    const points = [];
    for (let i = 0; i + 2 < def.grains.length; i += 3) points.push(new THREE.Vector3(def.grains[i], def.grains[i + 1], def.grains[i + 2]));
    return { n: Math.round(Math.sqrt(points.length)), spacing: (def.grainRadius ?? 0.0125) * 2, points };
  }
  const shape = shapeOf(def.shape);
  const scale = def.transform ? Math.cbrt(Math.abs(new THREE.Matrix3().fromArray(def.transform).determinant())) : 1;
  const n = Math.max(4, Math.round(Math.sqrt(material.grainCount)));
  const side = THREE.MathUtils.clamp(shape.size * scale * DRAPE_SIZE, SIDE.min, SIDE.max);
  const spacing = side / (n - 1);
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation));
  const at = new THREE.Vector3(...def.position);
  const points = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) points.push(new THREE.Vector3(i * spacing - side / 2, 0, j * spacing - side / 2).applyQuaternion(turn).add(at));
  return { n, spacing, points };
}

/** The sheet's surface: a grid of n × n vertices, two triangles a square, its UVs in metres. */
export function sheetGeometry(n, spacing) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      uv[(j * n + i) * 2] = i * spacing;
      uv[(j * n + i) * 2 + 1] = j * spacing;
    }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  g.setIndex(index);
  return g;
}

/**
 * One sheet of cloth (`def`, an object made of a cloth material): its points
 * and threads made in the world (and taken out after), drawn as one surface.
 * `pours`, `fluidGrains`: where it counts its points and gives them for
 * saving (see Fluids.jsx); `onClick(e, id)`: the tools; `grabs`: whether a
 * pointer press may pick it up (Select's left button, or the middle one).
 */
export function ClothSheet({ def, material, pours, fluidGrains, setBodies, onClick, grabs }) {
  const { world, rapier } = useRapier();
  const controls = useThree((s) => s.controls);
  const sheet = useMemo(() => sheetPoints(def, material), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => sheetGeometry(sheet.n, sheet.spacing), [sheet]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const drag = useRef(null); // { body, pointerId, ray, distance }

  useEffect(() => {
    const radius = sheet.spacing / 2;
    const volume = (4 / 3) * Math.PI * radius ** 3;
    const bodies = sheet.points.map((p) => {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setLinearDamping(0.3)
          .setAngularDamping(1)
          .setGravityScale(1 - AIR_DENSITY / material.density)
          .setCanSleep(true),
      );
      world.createCollider(
        rapier.ColliderDesc.ball(radius).setDensity(MASS_PER_POINT / volume).setFriction(material.friction).setRestitution(0).setCollisionGroups(GROUPS.object),
        body,
      );
      return body;
    });
    // the threads: each point to the next along each way of the weave
    const n = sheet.n;
    const thread = (a, b) => world.createImpulseJoint(rapier.JointData.rope(sheet.spacing, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), bodies[a], bodies[b], true);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        if (i < n - 1) thread(j * n + i, j * n + i + 1);
        if (j < n - 1) thread(j * n + i, (j + 1) * n + i);
      }
    const pour = { def, material, radius, bodies };
    pours.set(def.id, pour);
    fluidGrains.set(def.id, { material, radius, positions: () => pour.bodies.flatMap((b) => Object.values(b.translation())) });
    return () => {
      pours.delete(def.id);
      fluidGrains.delete(def.id);
      for (const b of pour.bodies) if (world.bodies.contains(b.handle)) world.removeRigidBody(b);
    };
  }, [world, rapier]); // eslint-disable-line react-hooks/exhaustive-deps

  const _at = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const pour = pours.get(def.id);
    if (!pour) return;
    const d = drag.current;
    if (d) d.body.setNextKinematicTranslation(d.ray.at(d.distance, _at));
    // (a sheet torn off the disc goes all at once)
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
          const dist = _at.copy(b.translation()).distanceToSquared(e.point);
          if (!best || dist < best.dist) best = { b, dist };
        }
        best.b.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
        drag.current = { body: best.b, pointerId: e.pointerId, ray: e.ray.clone(), distance: e.distance };
        e.target?.setPointerCapture?.(e.pointerId);
        if (controls) controls.enabled = false;
      }}
      onPointerMove={(e) => {
        if (drag.current?.pointerId === e.pointerId) drag.current.ray.copy(e.ray);
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      userData={{ cloth: def.id, holder: DRAG }}
    />
  );
}
