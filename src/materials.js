// The materials objects can be made of, read from materials.csv: one row a
// material, one column a property. Add a column there and every material has
// it here, as `material.row.<column>` (a number where it reads as one, null
// where empty), without changing this file. The columns used so far:
//
//   state                    solid, liquid, gas or plasma. Gases and plasmas don't collide: they
//                            float or sink in the air
//   density_kg_m3, fill      the substance's density, and how much of an object is it (a hollow one is
//                            mostly air): its mass is density × fill × volume
//   friction, restitution    how it slides and bounces. Friction combines by the lesser of the two
//                            surfaces (ice slides on anything), bounce by their average, or by
//                            restitution_combine (max: bouncy off anything)
//   color ... clearcoat      how it looks (three.js's MeshPhysicalMaterial, and glTF for Blender)
//   emissive, emissive_intensity, emissive_pattern   its glow (pattern: only in its texture's hollows,
//                            as lava glows through its cracks); light_cd: the light it casts (candela)
//   luster                   the mineralogist's word for its shine (metallic, vitreous, resinous, ...)
//   reflectance              how much light its surface mirrors when not a metal (0 to 1)
//   texture, texture_scale_m its surface pattern (see textures.js) and how big that is (m)
//   normal_strength          how deep the pattern's bumps look
//   pattern_contrast         how much the pattern lightens and darkens its colour
//   roughness_variance       how much the pattern varies its roughness (polished highs, rough lows)
//   color_variance           how much one object's colour differs from the next
//   impact_*, scrape_*       its sounds (see sound.js): a 10 cm object's ring when struck, and its
//                            hiss when it slides
//   gravity_scale, damping   overrides: how much gravity pulls it (else 1 less its buoyancy), and
//                            how quickly it settles (hovering things)
//   jiggle                   how much it wobbles when struck (a rigid body's looks only)
//   collides                 what it bumps into: all, floor (only the disc: heavy fog) or none
//                            (gases and plasmas, unless it says)
//   plasticity               0 to 1: dented, it stays dented (clay; a solid one squashes where it strikes)
//   soft_stiffness           a soft body's (and cloth's) pull back to its shape, each step: 0 (none) to 1 (rigid)
//   sticky                   0 to 1: it glues itself to what it touches, held until pulled
//                            that much apart (see Glue in Physics.jsx)
//   simulation, grain_count, sim_cohesion, sim_viscosity   made of many grains, not one solid
//                            (see Fluids.jsx): liquid (droplets that cling together, by
//                            sim_cohesion m/s², and drag on each other, by sim_viscosity 0 to 1),
//                            granular (sand), cloth (a stuffed shell of points held by threads)
//                            or soft (a shell that dents and springs back: see Cloth.jsx);
//                            about grain_count in a 10 cm cube's worth (cloth: in its sheet)
//   particles, particle_rate, impact_particles   the particles it gives off all the time, how many
//                            (× the preset's), and where struck (see particles.js)
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
  const collides = row.collides ?? (row.state !== 'gas' && row.state !== 'plasma' ? 'all' : 'none');
  return {
    id: row.id,
    /** collides with the objects (gases and plasmas pass through them) */
    solid: collides === 'all',
    name: row.name,
    state: row.state,
    /** kg/m³ of the object as a whole (a hollow one counts its air as nothing) */
    density: n(row.density_kg_m3, 1000) * fill,
    friction: n(row.friction, 0.5),
    restitution: n(row.restitution, 0.3),
    restitutionCombine: row.restitution_combine ?? 'average',
    /** what it bumps into: 'all', 'floor' (the disc only) or 'none' */
    collides,
    sticky: n(row.sticky, 0),
    plasticity: n(row.plasticity, 0),
    softStiffness: n(row.soft_stiffness, 0),
    simulation: row.simulation ?? null,
    grainCount: n(row.grain_count, 250),
    cohesion: n(row.sim_cohesion, 0),
    simViscosity: n(row.sim_viscosity, 0),
    gravityScale: typeof row.gravity_scale === 'number' ? row.gravity_scale : null,
    damping: n(row.damping, 0),
    jiggle: n(row.jiggle, 0),
    particles: row.particles ? { preset: row.particles, rate: n(row.particle_rate, 1) } : null,
    impactParticles: row.impact_particles ?? null,
    light: n(row.light_cd, 0),
    luster: row.luster,
    look: {
      color: row.color ?? '#888888',
      metalness: n(row.metalness, 0),
      roughness: n(row.roughness, 0.5),
      opacity: n(row.opacity, 1),
      transmission: n(row.transmission, 0),
      ior: n(row.ior, 1.5),
      sheen: n(row.sheen, 0),
      clearcoat: n(row.clearcoat, 0),
      emissive: row.emissive ?? null,
      emissiveIntensity: n(row.emissive_intensity, 0),
      emissivePattern: row.emissive_pattern === 'yes',
      reflectance: n(row.reflectance, 0.5),
      texture: row.texture ?? null,
      textureScale: n(row.texture_scale_m, 0.05),
      normalStrength: n(row.normal_strength, 0),
      patternContrast: n(row.pattern_contrast, 0),
      roughnessVariance: n(row.roughness_variance, 0),
      colorVariance: n(row.color_variance, 0),
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
/** A solid or liquid one at random (a gas would float away, a plasma hover). */
export function randomMaterial() {
  const pick = MATERIALS.filter((m) => m.solid && m.gravityScale == null && !m.simulation);
  return pick[Math.floor(Math.random() * pick.length)];
}
