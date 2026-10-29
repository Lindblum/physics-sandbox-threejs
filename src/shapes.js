import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

// The shapes the Tools make, real size: a 10 cm cube, a 10 cm ball, a
// cylinder 10 cm across and tall, a ring 14 cm across, and polyhedra 15 cm
// across their points. Each:
//   geometry   flat-shaded (the ball smooth), its UVs in metres (each face
//              mapped from its own plane), so textures keep their real size
//   pieces     convex point sets, its collider (the stellated ones are a core
//              with a pyramid on each face, which is what they are; the ring a
//              loop of short tubes); null where a primitive collider fits better
//   hull       convex pieces (Vector3 arrays) that stand for it once it's been
//              stretched or resized (see transformedPieces)
//   distance   how far a point is outside it
//   half       how high its centre stands when it rests on a surface
//   volume, radius (circumradius, m), size (the cube root of its volume:
//   its sound's size), area and drag (facing the air)
//   icon       an SVG of its visible edges, for the Tools dropdown

export const CUBE_SIZE = 0.1; // m along an edge
export const SPHERE_RADIUS = 0.05; // m
export const CYLINDER = { radius: 0.05, height: 0.1 }; // m
export const TORUS = { radius: 0.05, tube: 0.02 }; // m: the ring's, and its tube's (lying flat)
const POLY_RADIUS = 0.075; // m from the centre to the farthest point
const RING_PIECES = 16; // short tubes round the ring, each convex

const PHI = (1 + Math.sqrt(5)) / 2;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Every signed permutation of (a, b, c) (with `cyclic`, only the cyclic ones), each point once. */
function permutations([a, b, c], cyclic = false) {
  const orders = cyclic ? [[a, b, c], [c, a, b], [b, c, a]] : [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]];
  const out = new Map();
  for (const o of orders)
    for (const sx of [1, -1])
      for (const sy of [1, -1])
        for (const sz of [1, -1]) {
          const p = v3(o[0] * sx, o[1] * sy, o[2] * sz);
          out.set(p.toArray().map((x) => x.toFixed(6)).join(), p);
        }
  return [...out.values()];
}

const pointsOf = (geometry) => {
  const pos = geometry.getAttribute('position');
  const out = new Map();
  for (let i = 0; i < pos.count; i++) {
    const p = v3(pos.getX(i), pos.getY(i), pos.getZ(i));
    out.set(p.toArray().map((x) => x.toFixed(5)).join(), p);
  }
  return [...out.values()];
};

/** A convex hull's faces: each { n, d, points (the polygon, in order round it) }, coplanar triangles merged. */
function hullFaces(points) {
  const g = new ConvexGeometry(points);
  const pos = g.getAttribute('position');
  const faces = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = v3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const b = v3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    const c = v3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    let face = faces.find((f) => f.n.dot(n) > 0.9999);
    if (!face) faces.push((face = { n, d: n.dot(a), points: [] }));
    for (const p of [a, b, c]) if (!face.points.some((q) => q.distanceToSquared(p) < 1e-12)) face.points.push(p);
  }
  g.dispose();
  for (const f of faces) {
    // round the polygon in order, counter-clockwise seen from outside
    const centre = f.points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(f.points.length);
    const u = new THREE.Vector3().subVectors(f.points[0], centre).normalize();
    const w = new THREE.Vector3().crossVectors(f.n, u);
    f.centre = centre;
    f.points.sort((p, q) => {
      const ap = Math.atan2(p.clone().sub(centre).dot(w), p.clone().sub(centre).dot(u));
      const aq = Math.atan2(q.clone().sub(centre).dot(w), q.clone().sub(centre).dot(u));
      return ap - aq;
    });
  }
  return faces;
}

/**
 * The first stellation of a convex solid: over each face, the planes of the
 * faces around it, carried on past its edges, meet in a point. Returns the
 * pieces: the core, and a pyramid on each face up to that point.
 */
function stellate(points) {
  const faces = hullFaces(points);
  const shares = (f, g) => f.points.filter((p) => g.points.some((q) => q.distanceToSquared(p) < 1e-12)).length >= 2;
  const spikes = faces.map((f) => {
    const g = faces.find((h) => h !== f && shares(f, h));
    const s = (g.d - g.n.dot(f.centre)) / g.n.dot(f.n);
    return [...f.points, f.centre.clone().addScaledVector(f.n, s)];
  });
  return { core: points, spikes };
}

const scaled = (pieces, radius) => {
  const far = Math.max(...pieces.flat().map((p) => p.length()));
  return pieces.map((piece) => piece.map((p) => p.clone().multiplyScalar(radius / far)));
};

/** Box-projected UVs in metres: each triangle mapped from the plane its normal points most along. */
function planarUVs(geometry) {
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = [a, b, c][k];
      const [s, t] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y];
      uv[(i + k) * 2] = s;
      uv[(i + k) * 2 + 1] = t;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** A closed, outward-facing triangle soup's volume. */
function volumeOf(geometry) {
  const pos = geometry.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

/** The stellated solid's surface: each pyramid's sides (their bases are inside it). */
function spikedGeometry(spikes) {
  const tris = [];
  for (const spike of spikes) {
    const apex = spike.at(-1);
    const base = spike.slice(0, -1);
    const centre = base.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(base.length);
    for (let i = 0; i < base.length; i++) {
      const p = base[i];
      const q = base[(i + 1) % base.length];
      // outward: the triangle's normal away from the base's centre
      const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(apex, p));
      const mid = p.clone().add(q).add(apex).divideScalar(3);
      if (n.dot(mid.sub(centre)) >= 0) tris.push(p, q, apex);
      else tris.push(q, p, apex);
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints(tris);
  g.computeVertexNormals();
  return g;
}

/** The SVG of a shape's visible edges, seen from a little above and to the side, in the icons' style (24 px, 1.5 px strokes). */
function iconOf(geometry) {
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, -0.6, 0, 'XYZ'));
  const pos = geometry.getAttribute('position');
  const edges = new Map(); // key -> { a, b, normals }
  const key = (p) => p.toArray().map((x) => x.toFixed(4)).join();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, i + k).applyQuaternion(turn);
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    for (let k = 0; k < 3; k++) {
      const a = p[k].clone();
      const b = p[(k + 1) % 3].clone();
      const [ka, kb] = [key(a), key(b)];
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(id)) edges.set(id, { a, b, normals: [] });
      edges.get(id).normals.push(n);
    }
  }
  const far = Math.max(...[...edges.values()].flatMap((e) => [Math.hypot(e.a.x, e.a.y), Math.hypot(e.b.x, e.b.y)]));
  const xy = (q) => `${(12 + (q.x / far) * 10).toFixed(2)} ${(12 - (q.y / far) * 10).toFixed(2)}`;
  const lines = [];
  for (const { a, b, normals } of edges.values()) {
    const crease = normals.length < 2 || normals[0].dot(normals[1]) < 0.999; // (not a diagonal across a flat face)
    const seen = normals.some((n) => n.z > 1e-3);
    if (crease && seen) lines.push(`M${xy(a)}L${xy(b)}`);
  }
  return `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${lines.join('')}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function planesOf(points) {
  return hullFaces(points).map(({ n, d }) => ({ n, d }));
}

/** How far `p` is outside convex pieces `planes` (each a list of { n, d }). */
function planesDistance(planes, p) {
  let best = Infinity;
  for (const piece of planes) {
    let d = -Infinity;
    for (const { n, d: k } of piece) d = Math.max(d, n.dot(p) - k);
    best = Math.min(best, d);
  }
  return best;
}

/** A shape from convex `pieces` (the first piece's hull is the whole, unless `geometry` is given). */
function polyhedron(id, label, pieces, geometry = new ConvexGeometry(pieces[0])) {
  planarUVs(geometry);
  const volume = pieces.length > 1 ? pieces.reduce((v, piece) => v + volumeOf(new ConvexGeometry(piece)), 0) : volumeOf(geometry);
  const radius = Math.max(...pieces.flat().map((p) => p.length()));
  const size = Math.cbrt(volume);
  const planes = pieces.map(planesOf);
  return {
    id,
    label,
    geometry,
    pieces: pieces.map((piece) => new Float32Array(piece.flatMap((p) => p.toArray()))),
    hull: pieces,
    distance: (p) => planesDistance(planes, p),
    half: -Math.min(...pieces.flat().map((p) => p.y)),
    volume,
    radius,
    size,
    area: Math.PI * ((3 * volume) / (4 * Math.PI)) ** (2 / 3),
    drag: 0.8,
    icon: iconOf(geometry),
  };
}

function stellated(id, label, points) {
  const { core, spikes } = stellate(points);
  const [coreScaled, ...spikesScaled] = scaled([core, ...spikes], POLY_RADIUS);
  return polyhedron(id, label, [coreScaled, ...spikesScaled], spikedGeometry(spikesScaled));
}

const convex = (id, label, points) => polyhedron(id, label, scaled([points], POLY_RADIUS));

function sphere() {
  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 48, 24);
  // its UVs in metres: once round the equator, pole to pole
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * SPHERE_RADIUS, uv.getY(i) * Math.PI * SPHERE_RADIUS);
  const volume = (4 / 3) * Math.PI * SPHERE_RADIUS ** 3;
  return {
    id: 'sphere',
    label: 'Sphere',
    geometry,
    pieces: null,
    hull: [pointsOf(new THREE.IcosahedronGeometry(SPHERE_RADIUS, 3))],
    distance: (p) => p.length() - SPHERE_RADIUS,
    half: SPHERE_RADIUS,
    volume,
    radius: SPHERE_RADIUS,
    size: Math.cbrt(volume),
    area: Math.PI * SPHERE_RADIUS ** 2,
    drag: 0.47,
  };
}

function cube() {
  const h = CUBE_SIZE / 2;
  const shape = polyhedron('cube', 'Cube', [permutations([h, h, h])]);
  return { ...shape, pieces: null, area: CUBE_SIZE ** 2, drag: 1.05, icon: undefined };
}

// drawn to match the icons (24 px, 1.5 px strokes), as smooth shapes have no edges to draw
const svg = (d) =>
  `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function cylinder() {
  const { radius: r, height: h } = CYLINDER;
  const geometry = new THREE.CylinderGeometry(r, r, h, 48);
  // UVs in metres: round the side and up it; across the ends
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(normal.getY(i)) < 0.5) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r, uv.getY(i) * h);
    else uv.setXY(i, (uv.getX(i) - 0.5) * 2 * r, (uv.getY(i) - 0.5) * 2 * r);
  }
  const ring = (y) => Array.from({ length: 24 }, (_, i) => v3(r * Math.cos((i / 24) * Math.PI * 2), y, r * Math.sin((i / 24) * Math.PI * 2)));
  const volume = Math.PI * r * r * h;
  return {
    id: 'cylinder',
    label: 'Cylinder',
    geometry,
    pieces: null,
    hull: [[...ring(-h / 2), ...ring(h / 2)]],
    distance: (p) => {
      const dr = Math.hypot(p.x, p.z) - r;
      const dy = Math.abs(p.y) - h / 2;
      return Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) + Math.min(Math.max(dr, dy), 0);
    },
    half: h / 2,
    volume,
    radius: Math.hypot(r, h / 2),
    size: Math.cbrt(volume),
    area: 2 * r * h,
    drag: 0.9,
    icon: svg('M5 6.5c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75S15.9 3.75 12 3.75 5 5 5 6.5ZM5 6.5v11c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75v-11'),
  };
}

function torus() {
  const { radius: R, tube: t } = TORUS;
  const geometry = new THREE.TorusGeometry(R, t, 24, 64).rotateX(Math.PI / 2); // (lying flat)
  // UVs in metres: round the ring, and round the tube
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * R, uv.getY(i) * 2 * Math.PI * t);
  // the collider: short tubes round the ring, each the hull of the tube's circles at its two ends
  const circle = (a) =>
    Array.from({ length: 12 }, (_, i) => {
      const b = (i / 12) * Math.PI * 2;
      const out = R + t * Math.cos(b);
      return v3(out * Math.cos(a), t * Math.sin(b), out * Math.sin(a));
    });
  const pieces = Array.from({ length: RING_PIECES }, (_, i) => [
    ...circle((i / RING_PIECES) * Math.PI * 2),
    ...circle(((i + 1) / RING_PIECES) * Math.PI * 2),
  ]);
  const volume = 2 * Math.PI * Math.PI * R * t * t;
  return {
    id: 'torus',
    label: 'Torus',
    geometry,
    pieces: pieces.map((piece) => new Float32Array(piece.flatMap((p) => p.toArray()))),
    hull: pieces,
    distance: (p) => Math.hypot(Math.hypot(p.x, p.z) - R, p.y) - t,
    half: t,
    volume,
    radius: R + t,
    size: Math.cbrt(volume),
    area: Math.PI * (R + t) ** 2 * 0.6,
    drag: 1,
    icon: svg('M2.75 12c0 2.9 4.15 5.25 9.25 5.25s9.25-2.35 9.25-5.25S17.1 6.75 12 6.75 2.75 9.1 2.75 12ZM8 11.6c1.9 1.55 6.1 1.55 8 0M9 12.55c1.6-1.05 4.4-1.05 6 0'),
  };
}

export const SHAPES = Object.fromEntries(
  [
    cube(),
    sphere(),
    cylinder(),
    torus(),
    convex('tetrahedron', 'Tetrahedron', pointsOf(new THREE.TetrahedronGeometry(1))),
    convex('octahedron', 'Octahedron', pointsOf(new THREE.OctahedronGeometry(1))),
    convex('icosahedron', 'Icosahedron', pointsOf(new THREE.IcosahedronGeometry(1))),
    convex('dodecahedron', 'Dodecahedron', pointsOf(new THREE.DodecahedronGeometry(1))),
    stellated('stellatedDodecahedron', 'Stellated Dodecahedron', pointsOf(new THREE.DodecahedronGeometry(1))),
    stellated('stellatedIcosahedron', 'Stellated Icosahedron', pointsOf(new THREE.IcosahedronGeometry(1))),
    convex('rhombicDodecahedron', 'Rhombic Dodecahedron', [...permutations([1, 1, 1]), ...permutations([2, 0, 0])]),
    convex('truncatedOctahedron', 'Truncated Octahedron', permutations([0, 1, 2])),
    convex('rhombicTriacontahedron', 'Rhombic Triacontahedron', [
      ...permutations([0, 1, PHI], true),
      ...permutations([1, 1, 1]),
      ...permutations([0, PHI, 1 / PHI], true),
    ]),
  ].map((s) => [s.id, s]),
);

export const shapeOf = (id) => SHAPES[id] ?? SHAPES.cube;

/** How far `p` (in the shape's own space) is outside shape `id` (0 or less: inside it). */
export function distanceOutside(id, p) {
  return shapeOf(id).distance(p);
}

/**
 * A shape stretched or resized: `transform`, a 3×3 matrix (column-major, 9
 * numbers) on its own space. Returns its collider's convex pieces, each a
 * Float32Array of points, and how it measures up: { pieces, volume, radius, size, half, scale }
 * (`scale`: how much bigger on average, the cube root of how much more volume).
 */
const transformed = new Map();
export function transformedShape(id, transform) {
  const key = `${id}:${transform.map((x) => x.toFixed(4)).join()}`;
  if (transformed.has(key)) return transformed.get(key);
  const shape = shapeOf(id);
  const m = new THREE.Matrix3().fromArray(transform);
  const det = Math.abs(m.determinant());
  const pieces = shape.hull.map((piece) => piece.map((p) => p.clone().applyMatrix3(m)));
  const all = pieces.flat();
  const result = {
    pieces: pieces.map((piece) => new Float32Array(piece.flatMap((p) => p.toArray()))),
    volume: shape.volume * det,
    radius: Math.max(...all.map((p) => p.length())),
    size: shape.size * Math.cbrt(det),
    half: -Math.min(...all.map((p) => p.y)),
    scale: Math.cbrt(det),
  };
  if (transformed.size > 500) transformed.clear();
  transformed.set(key, result);
  return result;
}

// a shape's wireframe, for showing where it would go: its edges (the round
// ones drawn from a coarser mesh, so their lines are a lattice, not a blur)
const wires = new Map();
export function wireOf(id) {
  if (wires.has(id)) return wires.get(id);
  const coarse = {
    sphere: () => new THREE.SphereGeometry(SPHERE_RADIUS, 16, 10),
    cylinder: () => new THREE.CylinderGeometry(CYLINDER.radius, CYLINDER.radius, CYLINDER.height, 16),
    torus: () => new THREE.TorusGeometry(TORUS.radius, TORUS.tube, 8, 24).rotateX(Math.PI / 2),
  }[id];
  const wire = new THREE.EdgesGeometry(coarse ? coarse() : shapeOf(id).geometry, 10);
  wires.set(id, wire);
  return wire;
}

/**
 * Where something of shape `id`, resized by `transform` (or not), rests on a
 * surface at `point`, facing out along `normal` (world): on it if the surface
 * faces up (or down), beside it if it's a wall, a sliver apart. Returns its
 * centre (turned only about the vertical, it reaches as far down as made).
 */
export function restingPosition(id, transform, point, normal) {
  const m = transform ? transformedShape(id, transform) : shapeOf(id);
  const reach = Math.abs(normal.y) > 0.7 ? m.half : m.radius;
  return point.clone().addScaledVector(normal, reach + 0.005);
}
