// The materials objects can be made of, read from materials.csv: one row a
// material, one column a property. Add a column there and every material has
// it here, as `material.row.<column>` (a number where it reads as one, null
// where empty), without changing this file. The columns used so far:
//
//   state                    solid, liquid or gas. Gases don't collide: they float or sink in the air
//   density_kg_m3, fill      the substance's density, and how much of an object is it (a hollow one is
//                            mostly air): its mass is density × fill × volume
//   friction, restitution    how it slides and bounces. Friction combines by the lesser of the two
//                            surfaces (ice slides on anything), bounce by their average
//   color ... clearcoat      how it looks (three.js's MeshPhysicalMaterial, and glTF for Blender)
//   impact_*, scrape_*       its sounds (see sound.js): a 10 cm object's ring when struck, and its
//                            hiss when it slides
//   the rest                 for simulations to come (heat, melting, fluids, sound in it)

import table from './materials.csv?raw';

/** CSV text as rows of cells: quoted cells may hold commas, and "" for a quote. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') cell += text[++i];
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i;
const value = (s) => (s.trim() === '' ? null : NUMBER.test(s.trim()) ? Number(s) : s.trim());

/** One table row as a material. */
function material(row) {
  const n = (v, fallback) => (typeof v === 'number' ? v : fallback);
  const fill = n(row.fill, 1);
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    /** kg/m³ of the object as a whole (a hollow one counts its air as nothing) */
    density: n(row.density_kg_m3, 1000) * fill,
    friction: n(row.friction, 0.5),
    restitution: n(row.restitution, 0.3),
    look: {
      color: row.color ?? '#888888',
      metalness: n(row.metalness, 0),
      roughness: n(row.roughness, 0.5),
      opacity: n(row.opacity, 1),
      transmission: n(row.transmission, 0),
      ior: n(row.ior, 1.5),
      sheen: n(row.sheen, 0),
      clearcoat: n(row.clearcoat, 0),
    },
    sound: {
      hz: n(row.impact_hz, 0),
      ring: n(row.impact_ring_s, 0.05),
      modes: String(row.impact_modes ?? '1')
        .split(/\s+/)
        .map(Number)
        .filter((r) => r > 0),
      noise: n(row.impact_noise, 0.3),
      bright: n(row.impact_bright_hz, 4000),
      gain: n(row.impact_gain, 1),
      scrapeHz: n(row.scrape_hz, 1500),
      scrapeQ: n(row.scrape_q, 0.8),
      scrapeGain: n(row.scrape_gain, 0.5),
    },
    row,
  };
}

const [header, ...rows] = parseCsv(table);
export const MATERIALS = rows.map((cells) => material(Object.fromEntries(header.map((key, i) => [key, value(cells[i] ?? '')]))));
/** The table's columns, in order. */
export const MATERIAL_COLUMNS = header;

export const materialById = (id) => MATERIALS.find((m) => m.id === id) ?? MATERIALS.find((m) => m.id === 'wood');
/** What every object moves through: its drag, and its buoyancy (gases lighter than it rise). */
export const AIR = materialById('air');
export const AIR_DENSITY = AIR.density;
/** The disc's material. */
export const DISC_MATERIAL = materialById('concrete');
/** The ten starting cubes', one each. */
export const STARTING_MATERIALS = ['wood', 'steel', 'rubber', 'ice', 'glass', 'granite', 'foam', 'aluminium', 'gold', 'plastic'].map(materialById);
/** A solid or liquid one at random (a gas would float away). */
export function randomMaterial() {
  const pick = MATERIALS.filter((m) => m.state !== 'gas');
  return pick[Math.floor(Math.random() * pick.length)];
}
