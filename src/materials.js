// The physical materials objects are made of. Each sets its body's mass (from
// its density and size), how it slides (friction) and bounces (restitution),
// and how it looks. Friction combines by the lesser of the two surfaces (ice
// slides on anything), bounce by their average (see Physics.jsx).

export const MATERIALS = [
  { id: 'wood', name: 'Wood (Oak)', density: 750, friction: 0.5, restitution: 0.35, look: { color: '#a0703c', roughness: 0.75 } },
  { id: 'steel', name: 'Steel', density: 7850, friction: 0.45, restitution: 0.25, look: { color: '#9aa3ad', metalness: 0.8, roughness: 0.35 } },
  { id: 'rubber', name: 'Rubber', density: 1100, friction: 1.0, restitution: 0.85, look: { color: '#2f2f33', roughness: 0.95 } },
  { id: 'ice', name: 'Ice', density: 917, friction: 0.03, restitution: 0.1, look: { color: '#cfefff', roughness: 0.05, transparent: true, opacity: 0.7 } },
  { id: 'glass', name: 'Glass', density: 2500, friction: 0.4, restitution: 0.3, look: { color: '#a8d8e8', roughness: 0, transparent: true, opacity: 0.35 } },
  { id: 'granite', name: 'Granite', density: 2700, friction: 0.6, restitution: 0.2, look: { color: '#7d7570', roughness: 0.85 } },
  { id: 'foam', name: 'Foam', density: 30, friction: 0.8, restitution: 0.15, look: { color: '#f2e6a0', roughness: 1 } },
  { id: 'aluminium', name: 'Aluminium', density: 2700, friction: 0.4, restitution: 0.3, look: { color: '#d0d4d8', metalness: 0.8, roughness: 0.4 } },
  { id: 'gold', name: 'Gold', density: 19300, friction: 0.45, restitution: 0.15, look: { color: '#ffc94a', metalness: 0.7, roughness: 0.35 } },
  { id: 'plastic', name: 'Plastic', density: 950, friction: 0.35, restitution: 0.6, look: { color: '#e8443a', roughness: 0.4 } },
];

export const materialById = (id) => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
export const randomMaterial = () => MATERIALS[Math.floor(Math.random() * MATERIALS.length)];
