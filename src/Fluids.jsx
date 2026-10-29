import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIR_DENSITY, materialById } from './materials.js';
import { shapeOf } from './shapes.js';
import { GROUPS, lookMaterial, lookOf, onLooksChanged } from './Physics.jsx';
import { ClothSheet } from './Cloth.jsx';
import { pours, useGrainPointer } from './grains.js';

// Things made of grains rather than one solid (a material's `simulation`
// column): the shape a tool makes is filled with grains, each its own Rapier
// body, so they pour, splash, pile up and push and are pushed by the objects
// around them.
//
//   granular (sand)  angular grains (little boxes, drawn as faceted pebbles)
//                    with the material's friction: like real sand's, their
//                    corners catch on each other, so they heap and slide
//   liquid           slippery round droplets that also cling together
//                    (cohesion: neighbours pulled toward each other, so a liquid
//                    beads and holds together, mercury most) and drag on each
//                    other (viscosity: neighbours' velocities evened out, honey
//                    most); drawn as one smooth surface round them all
//                    (metaballs, marching cubes), so they run together
//
// A pour is as many grains as its volume holds, at about the material's
// grain_count for a 10 cm cube's worth, and MAX_GRAINS in all (the oldest
// pours go). Its grains that fall off the disc go; a pour with none left goes.
// A hand or the mouse takes a handful of them (see grains.js), and pointed at
// or held, a pour shows its material and mass (see MaterialLabels).

export const MAX_GRAINS = 2400;
const MIN_PER_POUR = 20;
const MAX_PER_POUR = 900;
const FALLEN_Y = -10;
const DRAWN = { liquid: 1.7, granular: 1.15 }; // drawn this much bigger than they collide
const WET_FRICTION = 0.25; // liquids' droplets cling to what they're on (wetting it) at least this much, so a puddle stops spreading
const REACH = 2.4; // liquids: a grain feels neighbours within this many radii
// a liquid's surface: a marching-cubes grid this fine across the box round its droplets
const SURFACE_MAX_HALF = 0.25; // m: the grid at most this far each way from its centre (so a droplet spans a cell or more); strays beyond are drawn as drops
const SURFACE_MAX_POLYS = 40000;
const SURFACE_MARGIN = 3; // droplet radii of room round them
const SURFACE_SUBTRACT = 12; // (the metaballs' falloff: a droplet's field reaches √((80 + this) / this) ≈ 2.8 times its own radius, so neighbours merge)
const GRAIN_BOX = 0.8; // sand: a grain's box, this times its radius from the centre to each face

/** A faceted pebble, a dodecahedron knocked out of true, unit size. */
function pebble() {
  const g = mergeVertices(new THREE.DodecahedronGeometry(1, 0).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.8 + Math.random() * 0.35), pos.getY(i) * (0.75 + Math.random() * 0.35), pos.getZ(i) * (0.8 + Math.random() * 0.35));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}
const GEOMETRY = { liquid: new THREE.IcosahedronGeometry(1, 1), granular: pebble() };

// a liquid's surface's look: its own, less its textures (the surface has no UVs)
const surfaceLooks = new Map();
onLooksChanged(() => {
  for (const look of surfaceLooks.values()) look.dispose();
  surfaceLooks.clear();
});
function surfaceLook(material) {
  if (!surfaceLooks.has(material.id)) {
    const look = lookMaterial(material);
    look.map = look.normalMap = look.roughnessMap = look.emissiveMap = null;
    surfaceLooks.set(material.id, look);
  }
  return surfaceLooks.get(material.id);
}

/** Each pour's grains now, by its object's id: { material, radius, positions() } (for saving: see sceneFile.js). */
export const fluidGrains = new Map();

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/** Where a pour's grains start, and how big they are: from a saved scene, or filling its shape (`detail`: Physics → Grain Detail, a multiplier on how many). */
function grainPoints(def, material, detail = 1) {
  if (def.grains) {
    const points = [];
    for (let i = 0; i + 2 < def.grains.length; i += 3) points.push(new THREE.Vector3(def.grains[i], def.grains[i + 1], def.grains[i + 2]));
    return { radius: def.grainRadius ?? 0.006, points };
  }
  const shape = shapeOf(def.shape);
  const t = def.transform ? new THREE.Matrix3().fromArray(def.transform) : new THREE.Matrix3();
  const det = Math.abs(t.determinant());
  const volume = shape.volume * det;
  const count = THREE.MathUtils.clamp((material.grainCount * detail * volume) / 0.001, MIN_PER_POUR, MAX_PER_POUR * Math.max(1, detail));
  const spacing = Math.cbrt(volume / count); // (in the world)
  const step = spacing / Math.cbrt(det); // (in the shape's own space)
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...def.rotation));
  const at = new THREE.Vector3(...def.position);
  const points = [];
  const r = shape.radius;
  for (let x = -r; x <= r; x += step)
    for (let y = -r; y <= r; y += step)
      for (let z = -r; z <= r; z += step) {
        // (a little out of line, as grains stacked exactly would balance on each other; never overlapping, or they'd burst apart)
        const j = () => (Math.random() - 0.5) * step * 0.1;
        _p.set(x + step / 2 + j(), y + step / 2 + j(), z + step / 2 + j());
        if (shape.distance(_p) > -step * 0.3) continue;
        points.push(_p.clone().applyMatrix3(t).applyQuaternion(turn).add(at));
      }
  return { radius: spacing / 2, points };
}

/**
 * One pour: its grains made in the world (and taken out after), drawn as one
 * instanced mesh (and a liquid's, with `smooth`, as one surface round them).
 */
function Pour({ def, setBodies, onClick, smooth, detail, resolution, grabs, pointed }) {
  const { world, rapier } = useRapier();
  const mesh = useRef(null);
  const material = materialById(def.material);
  const liquid = material.simulation === 'liquid';
  const grains = useMemo(() => grainPoints(def, material, detail), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = grains.radius * (DRAWN[material.simulation] ?? 1);
  // a liquid's one surface round its droplets
  const surface = useMemo(() => {
    if (!liquid || !smooth) return null;
    const mc = new MarchingCubes(resolution, surfaceLook(material), false, false, SURFACE_MAX_POLYS);
    mc.castShadow = mc.receiveShadow = true;
    mc.frustumCulled = false;
    return mc;
  }, [liquid, smooth, material, resolution]);
  useEffect(() => () => surface?.geometry.dispose(), [surface]);
  const surfaceRef = useRef(null);
  surfaceRef.current = surface;
  if (surface) surface.material = surfaceLook(material); // (made again when Video's looks change)

  useEffect(() => {
    const granular = material.simulation === 'granular';
    const bodies = grains.points.map((p) => {
      const desc = rapier.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setLinearDamping(granular ? 0.05 : 0.4)
        .setAngularDamping(granular ? 3 : 2)
        .setGravityScale(1 - AIR_DENSITY / material.density)
        .setCanSleep(true);
      if (granular) desc.setRotation(new THREE.Quaternion().random()); // (each grain its own way round)
      if (def.linvel) desc.setLinvel(...def.linvel);
      const body = world.createRigidBody(desc);
      const box = grains.radius * GRAIN_BOX;
      const ball = grains.radius * 0.9;
      // each grain weighs its share of the pour (the space it stands for, not just its collider's)
      const share = (2 * grains.radius) ** 3;
      const held = granular ? (2 * box) ** 3 : (4 / 3) * Math.PI * ball ** 3;
      const collider = (granular ? rapier.ColliderDesc.cuboid(box, box, box) : rapier.ColliderDesc.ball(ball))
        .setDensity((material.density * share) / held)
        .setFriction(granular ? material.friction : Math.max(material.friction, WET_FRICTION))
        .setRestitution(material.restitution)
        .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
        .setCollisionGroups(GROUPS.object);
      world.createCollider(collider, body);
      return body;
    });
    const pour = { def, material, radius: grains.radius, bodies, meshes: () => [surfaceRef.current, mesh.current] };
    pours.set(def.id, pour);
    fluidGrains.set(def.id, {
      material,
      radius: grains.radius,
      positions: () => pour.bodies.flatMap((b) => Object.values(b.translation())),
    });
    return () => {
      pours.delete(def.id);
      fluidGrains.delete(def.id);
      for (const b of pour.bodies) if (world.bodies.contains(b.handle)) world.removeRigidBody(b);
    };
  }, [world, rapier]); // eslint-disable-line react-hooks/exhaustive-deps

  // each frame: the grains drawn where they are (a liquid's surface round them), and those fallen off taken away
  useFrame(() => {
    const pour = pours.get(def.id);
    const m = mesh.current;
    if (!pour || (!m && !surface)) return;
    let gone = false;
    pour.bodies = pour.bodies.filter((b) => {
      if (b.translation().y >= FALLEN_Y || b.isKinematic()) return true; // (held ones stay)
      world.removeRigidBody(b);
      gone = true;
      return false;
    });
    if (gone && !pour.bodies.length) setBodies((list) => list.filter((b) => b.id !== def.id));
    // a liquid: its surface round those in the grid, and any strays beyond it as drops; sand: its grains
    const strays = surface ? drawSurface(surface, pour.bodies, grains.radius) : pour.bodies;
    if (m) {
      _s.setScalar(surface ? grains.radius * 1.25 : drawn);
      strays.forEach((b, i) => {
        m.setMatrixAt(i, _m.compose(_p.copy(b.translation()), _q.copy(b.rotation()), _s));
      });
      m.count = strays.length;
      m.instanceMatrix.needsUpdate = true;
      m.boundingSphere = null; // (where they are now, for pointing at them: worked out again when next needed)
    }
  });

  const handlers = { ...useGrainPointer(def.id, grabs, pointed), onClick: (e) => onClick(e, def.id) };
  if (surface) surface.userData.pourId = def.id;
  return (
    <>
      {surface && <primitive object={surface} {...handlers} />}
      <instancedMesh
        ref={mesh}
        args={[GEOMETRY[material.simulation] ?? GEOMETRY.liquid, lookOf(material), grains.points.length]}
        frustumCulled={false}
        castShadow
        receiveShadow
        userData={{ pourId: def.id }}
        {...handlers}
      />
    </>
  );
}

const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

/** The value `share` of the way through `values` (sorted in place). */
function quantile(values, share) {
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(share * values.length))];
}

/**
 * A liquid's surface: the marching-cubes grid fitted round the bulk of its
 * droplets (a cube, so they stay round in it; ignoring the outermost few, and
 * no bigger than SURFACE_MAX_HALF, so a droplet spans a cell or more), each
 * droplet in it a metaball as big as it is, and the surface drawn where their
 * fields add up to the grid's isolation. Returns the droplets outside it.
 */
function drawSurface(mc, bodies, radius) {
  mc.reset();
  if (!bodies.length) {
    mc.update();
    return [];
  }
  const at = bodies.map((b) => b.translation());
  const axis = (k) => at.map((t) => t[k]);
  const xs = axis('x');
  const ys = axis('y');
  const zs = axis('z');
  _min.set(quantile(xs, 0.05), quantile(ys, 0.05), quantile(zs, 0.05));
  _max.set(quantile(xs, 0.95), quantile(ys, 0.95), quantile(zs, 0.95));
  const margin = radius * SURFACE_MARGIN;
  const half = Math.min(SURFACE_MAX_HALF, Math.max(_max.x - _min.x, _max.y - _min.y, _max.z - _min.z) / 2 + margin);
  mc.position.addVectors(_min, _max).multiplyScalar(0.5);
  mc.scale.setScalar(half);
  // (the grid's 0 to 1 spans 2 × half in the world; a droplet's surface where strength / d² - subtract = isolation)
  const r = (radius * 1.4) / (2 * half);
  const strength = r * r * (mc.isolation + SURFACE_SUBTRACT);
  const inner = half - margin;
  const strays = [];
  at.forEach((t, i) => {
    const x = t.x - mc.position.x;
    const y = t.y - mc.position.y;
    const z = t.z - mc.position.z;
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > inner) strays.push(bodies[i]);
    else mc.addBall(x / (2 * half) + 0.5, y / (2 * half) + 0.5, z / (2 * half) + 0.5, strength, SURFACE_SUBTRACT);
  });
  mc.update();
  mc.geometry.computeBoundingSphere(); // (so clicks and taps find it)
  return strays;
}

/**
 * Liquids' grains cling together and drag on each other: before each step,
 * each pair of neighbours (within REACH radii) is pulled together by the
 * material's cohesion and has its velocities evened out by its viscosity.
 */
function liquidForces(pours, dt) {
  const byMaterial = new Map();
  for (const pour of pours.values()) {
    if (pour.material.simulation !== 'liquid' || !pour.bodies.length) continue;
    const group = byMaterial.get(pour.material.id) ?? { material: pour.material, bodies: [], radius: 0 };
    group.bodies.push(...pour.bodies);
    group.radius = Math.max(group.radius, pour.radius);
    byMaterial.set(pour.material.id, group);
  }
  for (const { material, bodies, radius } of byMaterial.values()) {
    const n = bodies.length;
    const h = radius * REACH;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const dv = new Float32Array(n * 3);
    const weight = new Float32Array(n);
    const cells = new Map();
    const cellOf = (x, y, z) => `${Math.floor(x / h)},${Math.floor(y / h)},${Math.floor(z / h)}`;
    bodies.forEach((b, i) => {
      const t = b.translation();
      const v = b.linvel();
      pos.set([t.x, t.y, t.z], i * 3);
      vel.set([v.x, v.y, v.z], i * 3);
      const key = cellOf(t.x, t.y, t.z);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    });
    const pull = material.cohesion * dt;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[i * 3] / h);
      const cy = Math.floor(pos[i * 3 + 1] / h);
      const cz = Math.floor(pos[i * 3 + 2] / h);
      for (let x = cx - 1; x <= cx + 1; x++)
        for (let y = cy - 1; y <= cy + 1; y++)
          for (let z = cz - 1; z <= cz + 1; z++) {
            const cell = cells.get(`${x},${y},${z}`);
            if (!cell) continue;
            for (const j of cell) {
              if (j <= i) continue;
              const dx = pos[j * 3] - pos[i * 3];
              const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
              const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
              const d = Math.hypot(dx, dy, dz);
              if (d >= h || d < 1e-6) continue;
              const w = 1 - d / h;
              // cohesion: toward each other
              const c = (pull * w) / d;
              dv[i * 3] += dx * c;
              dv[i * 3 + 1] += dy * c;
              dv[i * 3 + 2] += dz * c;
              dv[j * 3] -= dx * c;
              dv[j * 3 + 1] -= dy * c;
              dv[j * 3 + 2] -= dz * c;
              // viscosity: their velocities toward each other's (weighed, below, by how many neighbours each has)
              for (let a = 0; a < 3; a++) {
                const rel = (vel[j * 3 + a] - vel[i * 3 + a]) * material.simViscosity * w * 0.5;
                dv[i * 3 + a] += rel;
                dv[j * 3 + a] -= rel;
              }
              weight[i] += w;
              weight[j] += w;
            }
          }
    }
    bodies.forEach((b, i) => {
      if (b.isSleeping()) return;
      const k = 1 / Math.max(1, weight[i]);
      b.setLinvel({ x: vel[i * 3] + dv[i * 3] * k, y: vel[i * 3 + 1] + dv[i * 3 + 1] * k, z: vel[i * 3 + 2] + dv[i * 3 + 2] * k }, false);
    });
  }
}

/**
 * Every pour among `bodies` (those with `fluid`), and their liquids' forces;
 * `smooth`: Video → Liquid Surfaces (metaballs), `resolution`: Liquid Surface
 * Detail (the metaballs' grid); `grainDetail`, `clothDetail`: Physics → Grain
 * Detail and Cloth Detail (for what's made from now on); `grabs(e)`: whether
 * a press picks some up, `pointed`: pointer id -> object id (for labels).
 * `setBodies` takes a pour away when it's gone, or the oldest when there are
 * more than MAX_GRAINS grains; `onClick(e, id)`: a click on the grains (the
 * tools: see Scene.jsx); cloth (see Cloth.jsx): `grabs(e)`, whether a press picks it up.
 */
export function Fluids({ bodies, setBodies, onClick, smooth, grabs, pointed, resolution, grainDetail, clothDetail }) {
  useBeforePhysicsStep((world) => liquidForces(pours, world.timestep));
  // too many grains: the oldest pour goes
  useFrame(() => {
    let total = 0;
    for (const p of pours.values()) total += p.bodies.length;
    if (total <= MAX_GRAINS * Math.max(1, grainDetail) || pours.size < 2) return;
    const oldest = Math.min(...pours.keys());
    setBodies((list) => list.filter((b) => b.id !== oldest));
  });
  return bodies.map((def) => {
    if (!def.fluid) return null;
    const material = materialById(def.material);
    if (material.simulation === 'cloth' || material.simulation === 'soft')
      return (
        <ClothSheet key={def.id} def={def} material={material} fluidGrains={fluidGrains} setBodies={setBodies} onClick={onClick} grabs={grabs} pointed={pointed} detail={clothDetail} />
      );
    return <Pour key={def.id} def={def} setBodies={setBodies} onClick={onClick} smooth={smooth} detail={grainDetail} resolution={resolution} grabs={grabs} pointed={pointed} />;
  });
}
