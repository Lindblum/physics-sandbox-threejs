// Options → File: the scene saved as glTF binary (.glb), which Blender opens
// (File → Import → glTF 2.0), and opened again from one.
//
// The file holds the disc and every object as it is now, in metres, Y up
// (Blender turns that to Z up), each object's look as a PBR material (glass,
// water and the like see-through, refracting by their index of refraction),
// and the sun. Each object also carries what it's made of, as glTF extras,
// which Blender shows as custom properties (Object Properties → Custom
// Properties): sandbox_shape, sandbox_material, mass_kg, density_kg_m3,
// friction, restitution, state, and its linvel / angvel (m/s, rad/s) so a
// scene opened again carries on moving; a resized one also its
// sandbox_transform (3×3, column-major, on its shape's own space; its mesh
// comes resized). Scaling an object in Blender resizes it here too. A liquid
// or sand (grains: see Fluids.jsx) is one mesh of its droplets or grains,
// with sandbox_fluid, sandbox_grains (each one's x, y, z, world) and
// sandbox_grain_radius, and opens as they were. Opening reads those back, from any
// .glb that has them (one saved here, or from Blender with them kept).

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DISC, lookMaterial, makeBody } from './Physics.jsx';
import { DISC_MATERIAL, MATERIALS, materialById } from './materials.js';
import { SHAPES, shapeOf } from './shapes.js';
import { fluidGrains } from './Fluids.jsx';
import { sheetGeometry } from './Cloth.jsx';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FORMAT = 'physics-sandbox'; // the scene's extras: { format, version, gravity }
const VERSION = 1;

const round = (v, digits = 5) => +v.toFixed(digits);
const vector = (v) => [round(v.x), round(v.y), round(v.z)];

/**
 * The scene now as a .glb, downloaded. `bodies`: the objects (see
 * Physics.jsx); `registry`: where their Rapier bodies are, for where they are
 * now and how they're moving; `gravity`: on or off.
 */
export async function saveScene({ bodies, registry, gravity }) {
  const scene = new THREE.Scene();
  scene.name = 'Physics Sandbox';
  scene.userData = { format: FORMAT, version: VERSION, gravity, units: 'metres, Y up' };

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(DISC.radius, DISC.radius, DISC.thickness, 96), lookMaterial(DISC_MATERIAL, { transmission: true, detail: true }));
  disc.name = 'Disc';
  disc.position.y = -DISC.thickness / 2;
  disc.userData = { sandbox_fixed: true, sandbox_material: DISC_MATERIAL.id, state: 'solid' };
  scene.add(disc);

  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.name = 'Sun';
  sun.position.set(1.5, 4, 1);
  // (glTF lights shine down their -Z: the target a child straight ahead, the light turned to the disc)
  sun.add(sun.target);
  sun.target.position.set(0, 0, -1);
  sun.lookAt(0, 0, 0);
  scene.add(sun);

  const looks = new Map();
  const count = new Map();
  for (const def of bodies) {
    if (def.fluid) {
      const pour = fluidGrains.get(def.id);
      if (pour?.positions().length) scene.add(grainsMesh(def, pour, looks));
      continue;
    }
    const material = materialById(def.material);
    if (!looks.has(material.id)) looks.set(material.id, lookMaterial(material, { transmission: true, detail: true }));
    const shape = shapeOf(def.shape);
    // (a resized one: its mesh resized, so the object's own transform stays rigid)
    const geometry = def.transform ? shape.geometry.clone().applyMatrix4(new THREE.Matrix4().setFromMatrix3(new THREE.Matrix3().fromArray(def.transform))) : shape.geometry;
    const mesh = new THREE.Mesh(geometry, looks.get(material.id));
    const n = (count.get(material.id) ?? 0) + 1;
    count.set(material.id, n);
    mesh.name = `${material.name} ${shape.label} ${n}`;
    const b = registry.get(def.id)?.body.current;
    if (b) {
      mesh.position.copy(b.translation());
      mesh.quaternion.copy(b.rotation());
    } else {
      mesh.position.fromArray(def.position);
      mesh.rotation.fromArray(def.rotation);
    }
    const volume = shape.volume * (def.transform ? Math.abs(new THREE.Matrix3().fromArray(def.transform).determinant()) : 1);
    mesh.userData = {
      sandbox_shape: def.shape,
      sandbox_material: material.id,
      sandbox_start: def.start,
      state: material.state,
      mass_kg: round(b?.mass() ?? material.density * volume),
      density_kg_m3: round(material.density),
      friction: material.friction,
      restitution: material.restitution,
      linvel: b ? vector(b.linvel()) : [0, 0, 0],
      angvel: b ? vector(b.angvel()) : [0, 0, 0],
      ...(def.transform && { sandbox_transform: def.transform.map((x) => round(x, 6)) }),
    };
    scene.add(mesh);
  }

  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  disc.geometry.dispose();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  download(new Blob([glb], { type: 'model/gltf-binary' }), `physics-sandbox-${stamp}.glb`);
}

/** A pour's grains as one mesh (what Blender shows), and where each is (for opening it again). */
function grainsMesh(def, pour, looks) {
  const { material, radius } = pour;
  const at = pour.positions();
  if (!looks.has(material.id)) looks.set(material.id, lookMaterial(material, { transmission: true, detail: true }));
  let geometry;
  if (material.simulation === 'cloth') {
    // a sheet: its surface through its points
    geometry = sheetGeometry(Math.round(Math.sqrt(at.length / 3)), radius * 2);
    geometry.getAttribute('position').array.set(at);
    geometry.computeVertexNormals();
  } else {
    const ball = new THREE.IcosahedronGeometry(radius * (material.simulation === 'liquid' ? 1.35 : 1), 1);
    const parts = [];
    for (let i = 0; i < at.length; i += 3) parts.push(ball.clone().translate(at[i], at[i + 1], at[i + 2]));
    geometry = mergeGeometries(parts);
  }
  const look = material.simulation === 'cloth' ? Object.assign(looks.get(material.id).clone(), { side: THREE.DoubleSide }) : looks.get(material.id);
  const mesh = new THREE.Mesh(geometry, look);
  mesh.name = `${material.name} ${{ liquid: 'droplets', granular: 'grains', cloth: 'sheet' }[material.simulation]}`;
  const n = at.length / 3;
  mesh.userData = {
    sandbox_fluid: true,
    sandbox_shape: def.shape,
    sandbox_material: material.id,
    sandbox_grain_radius: round(radius, 6),
    sandbox_grains: at.map((x) => round(x, 4)),
    state: material.state,
    mass_kg: round(material.density * (4 / 3) * Math.PI * radius ** 3 * n),
    density_kg_m3: round(material.density),
  };
  return mesh;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Asks for a .glb and reads it: resolves to { bodies, gravity? }, or null if none was chosen. */
export function openScene() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) readScene(file).then(resolve, reject);
      else resolve(null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** The objects in a glTF file (`file`, a File): those with a shape and a material. */
export async function readScene(file) {
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  const bodies = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const d = o.userData;
    if (d?.sandbox_fluid && Array.isArray(d.sandbox_grains) && MATERIALS.some((m) => m.id === d.sandbox_material)) {
      // a pour: its grains where they were (moved with its mesh, if moved in Blender)
      const grains = [];
      for (let i = 0; i + 2 < d.sandbox_grains.length; i += 3) grains.push(..._p.fromArray(d.sandbox_grains, i).applyMatrix4(o.matrixWorld).toArray());
      if (grains.length) bodies.push(makeBody(SHAPES[d.sandbox_shape] ? d.sandbox_shape : 'cube', d.sandbox_material, grains.slice(0, 3), [0, 0, 0], false, { fluid: true, grains, grainRadius: Number(d.sandbox_grain_radius) || 0.006 }));
      return;
    }
    if (!SHAPES[d?.sandbox_shape] || !MATERIALS.some((m) => m.id === d.sandbox_material)) return;
    o.matrixWorld.decompose(_p, _q, _s);
    _e.setFromQuaternion(_q);
    const motion = {};
    if (Array.isArray(d.linvel) && d.linvel.length === 3) motion.linvel = d.linvel.map(Number);
    if (Array.isArray(d.angvel) && d.angvel.length === 3) motion.angvel = d.angvel.map(Number);
    // resized: here, or scaled in Blender (its scale on top)
    const transform = new THREE.Matrix3();
    if (Array.isArray(d.sandbox_transform) && d.sandbox_transform.length === 9) transform.fromArray(d.sandbox_transform.map(Number));
    if (Math.abs(_s.x - 1) + Math.abs(_s.y - 1) + Math.abs(_s.z - 1) > 1e-4) transform.premultiply(new THREE.Matrix3().set(_s.x, 0, 0, 0, _s.y, 0, 0, 0, _s.z));
    if (!transform.equals(new THREE.Matrix3())) motion.transform = transform.toArray();
    bodies.push(makeBody(d.sandbox_shape, d.sandbox_material, _p.toArray(), [_e.x, _e.y, _e.z], d.sandbox_start === true, motion));
  });
  if (!bodies.length) throw new Error(`${file.name} has no Physics Sandbox objects in it`);
  const extras = gltf.scene.userData;
  return { bodies, gravity: extras?.format === FORMAT && typeof extras.gravity === 'boolean' ? extras.gravity : undefined };
}
