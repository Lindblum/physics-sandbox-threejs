import sun from 'lineicons/assets/svgs/regular/sun-1.svg?raw';
import ban from 'lineicons/assets/svgs/regular/ban-2.svg?raw';
import globe from 'lineicons/assets/svgs/regular/globe-1.svg?raw';
import picture from 'lineicons/assets/svgs/regular/gallery.svg?raw';
import eye from 'lineicons/assets/svgs/regular/eye.svg?raw';
import gear from 'lineicons/assets/svgs/regular/gear-1.svg?raw';
import rotate from 'lineicons/assets/svgs/regular/refresh-circle-1-clockwise.svg?raw';
import pause from 'lineicons/assets/svgs/regular/pause.svg?raw';
import diamond from 'lineicons/assets/svgs/regular/diamonds-1.svg?raw';
import chevronDown from 'lineicons/assets/svgs/regular/chevron-down.svg?raw';
import chevronUp from 'lineicons/assets/svgs/regular/chevron-up.svg?raw';
import check from 'lineicons/assets/svgs/regular/check.svg?raw';
import gamepad from 'lineicons/assets/svgs/regular/game-pad-modern-1.svg?raw';
import play from 'lineicons/assets/svgs/regular/play.svg?raw';
import selectCursor from 'lineicons/assets/svgs/regular/select-cursor-1.svg?raw';
import arrowDown from 'lineicons/assets/svgs/regular/arrow-downward.svg?raw';
import floppy from 'lineicons/assets/svgs/regular/floppy-disk-1.svg?raw';
import folder from 'lineicons/assets/svgs/regular/folder-1.svg?raw';
import filePlus from 'lineicons/assets/svgs/regular/file-plus-circle.svg?raw';
import volume from 'lineicons/assets/svgs/regular/volume-high.svg?raw';
import volumeMute from 'lineicons/assets/svgs/regular/volume-mute.svg?raw';
import bulb from 'lineicons/assets/svgs/regular/bulb-2.svg?raw';
import clipboard from 'lineicons/assets/svgs/regular/clipboard.svg?raw';
import trash from 'lineicons/assets/svgs/regular/trash-3.svg?raw';
import layers from 'lineicons/assets/svgs/regular/layers-1.svg?raw';
import cloud from 'lineicons/assets/svgs/regular/cloud-2.svg?raw';
import waterDrop from 'lineicons/assets/svgs/regular/water-drop-1.svg?raw';
import shirt from 'lineicons/assets/svgs/regular/shirt-1.svg?raw';
import { SHAPES } from './shapes.js';

// Lineicons ship with a fixed fill; recolour to follow the surrounding text
// and size to the font.
const recolour = (svg) =>
  svg
    .replace(/fill="#323544"/g, 'fill="currentColor"')
    .replace(/\swidth="\d+"\sheight="\d+"/, ' width="1.25em" height="1.25em" aria-hidden="true"');

// The free Lineicons set has no VR headset (its "oculus" icon is the brand
// wordmark) and no cube, so these are drawn to match: 24px grid, 1.5px
// rounded strokes.
const headset = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.13a1.5 1.5 0 0 1-1.3-.76l-.77-1.35a1.5 1.5 0 0 0-2.6 0l-.77 1.35a1.5 1.5 0 0 1-1.3.76H5.5A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3 11.5H1.75M21 11.5h1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const cube = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M12 2.75 20.25 7.25v9.5L12 21.25 3.75 16.75v-9.5L12 2.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3.75 7.25 12 11.75l8.25-4.5M12 11.75v9.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

// Sphere: a circle with an equator and a meridian
const sphere = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5"/>
<path d="M2.75 12c0 2.2 4.14 4 9.25 4s9.25-1.8 9.25-4M12 2.75c-2.2 0-4 4.14-4 9.25s1.8 9.25 4 9.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Solid background: a filled rectangle, as in grid-game-threejs
const solid = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="5" width="18.5" height="14" rx="1.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Stereo: a pair of eyes (one-eye Mono is Lineicons' eye)
const eyes = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M1.75 12C3.5 9 9 9 10.75 12 9 15 3.5 15 1.75 12Z M13.25 12C15 9 20.5 9 22.25 12 20.5 15 15 15 13.25 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="6.25" cy="12" r="1.4" fill="currentColor"/>
<circle cx="17.75" cy="12" r="1.4" fill="currentColor"/>
</svg>`;

// View Mode icons, drawn to match: a screen, the screen split in two,
// the screen in rows, a phone, and a phone turned sideways in a viewer (two lenses)
const monitor = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="4.25" width="18.5" height="12" rx="1.75" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 16.25v3.5M8.5 19.75h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Video: the screen with a play arrow in it
const video = monitor.replace(
  '</svg>',
  `<path d="M10.25 7.6v5.3l4.4-2.65-4.4-2.65Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
</svg>`,
);

const monitorSbs = monitor.replace(
  '</svg>',
  `<path d="M12 6v8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="7.4" cy="10.25" r="1.4" fill="currentColor"/>
<circle cx="16.6" cy="10.25" r="1.4" fill="currentColor"/>
</svg>`,
);

// Interlaced: the screen's rows, alternate ones solid and dashed
const monitorInterlaced = monitor.replace(
  '</svg>',
  `<path d="M6 7.75h12M6 12.75h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6 10.25h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2.5"/>
</svg>`,
);

const phone = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="6.75" y="2.75" width="10.5" height="18.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M10.75 18.25h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const phoneViewer = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="6.75" width="18.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 6.75v10.5" stroke="currentColor" stroke-width="1.5"/>
<circle cx="7.4" cy="12" r="2.1" stroke="currentColor" stroke-width="1.5"/>
<circle cx="16.6" cy="12" r="2.1" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Edges: a wire frame, a ball at each corner
const edges = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5 5h14v14H5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="5" cy="5" r="2" fill="currentColor"/>
<circle cx="19" cy="5" r="2" fill="currentColor"/>
<circle cx="5" cy="19" r="2" fill="currentColor"/>
<circle cx="19" cy="19" r="2" fill="currentColor"/>
</svg>`;

// XR unavailable: the headset, struck through
const headsetOff = headset.replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

// Accessibility: the figure with open arms, in a circle
const accessibility = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5"/>
<circle cx="12" cy="7.4" r="1.4" fill="currentColor"/>
<path d="M7.5 10.1 12 11l4.5-.9M12 11v3.2m0 0-2.2 3.6m2.2-3.6 2.2 3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Text Size: a big A beside a small one
const textSize = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M2.75 19.25 8 4.75l5.25 14.5M4.6 14.25h6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14.25 19.25 17.75 10l3.5 9.25M15.5 16.25h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// VSync, as in grid-game-threejs: a display with a frame edge running
// straight down it, or, off, torn: the edge jumping sideways halfway down
const vsyncOn = monitor.replace(
  '</svg>',
  `<path d="M10.5 6.75v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);
const vsyncOff = monitor.replace(
  '</svg>',
  `<path d="M9.5 6.75v3.5M13.5 10.25v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6 10.25h12" stroke="currentColor" stroke-width="1" stroke-opacity="0.45" stroke-linecap="round"/>
</svg>`,
);

// XR Resolution: a pixel grid, its cells finer toward one corner (as in grid-game-threejs)
const xrResolution = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="3.75" y="3.75" width="16.5" height="16.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 3.75v16.5M3.75 12h16.5" stroke="currentColor" stroke-width="1.5"/>
<path d="M7.9 3.75V12M3.75 7.9H12" stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
</svg>`;

// Controller Guide: a gamepad, struck through when off
const controllerGuideOn = recolour(gamepad);
const controllerGuideOff = recolour(gamepad).replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

const gravity = recolour(arrowDown);
const gravityOff = gravity.replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

/** `svg` struck through, for an effect turned off. */
const struck = (svg) => svg.replace('</svg>', '<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
const drawn = (d) =>
  `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// Refraction (as grid-game-threejs's): a gem with a ray of light bent as it passes through;
// off, the ray goes straight through
const GEM = 'M7.87 5.81 16.13 5.81 19.02 9.52 12 19.02 4.98 9.52Z';
const refractionOn = drawn(`${GEM}M2.92 9.11 7.87 11.17 16.13 14.48 21.08 19.43`);
const refractionOff = drawn(`${GEM}M2.92 9.11 21.08 16.54`);
// Physics: an atom, three orbits round a nucleus
const physics = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="12" rx="10" ry="3.9"/><ellipse cx="12" cy="12" rx="10" ry="3.9" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="3.9" transform="rotate(-60 12 12)"/></g><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>`;
// Soft Bodies: a blob slumped on the ground
const soft = drawn('M4.5 17.5c-.6-4.6 2.6-9.5 7.5-9.5s8.1 4.9 7.5 9.5ZM2.75 20.25h18.5');
// Jiggle: a block of jelly with wobble lines either side
const jiggle = drawn('M7.5 7.25c1.5-.6 7.5-.6 9 0 .6 3.2.6 8.3 0 11.5-1.5.6-7.5.6-9 0-.6-3.2-.6-8.3 0-11.5ZM4.25 9.5c-.9 1.5-.9 3.5 0 5M19.75 9.5c.9 1.5.9 3.5 0 5');
// Material (as grid-game-threejs's Materials): a hexagonal block face with a crack and speckles
const material = drawn('M12 4.16 18.79 8.08 18.79 15.92 12 19.84 5.21 15.92 5.21 8.08ZM8.7 7.87 11.17 11.17 10.35 13.65 13.24 16.54M11.17 11.17 15.3 10.35').replace(
  '</svg>',
  '<circle cx="15.3" cy="14.48" r="0.72" fill="currentColor"/><circle cx="7.87" cy="13.24" r="0.72" fill="currentColor"/></svg>',
);
// Grains: a heap of sand, a few grains still falling onto it
const grains = drawn('M2.75 19.75c2.5-4.5 5.5-7 9.25-7s6.75 2.5 9.25 7ZM12 4.5v.01M9 8v.01M15 7v.01');
// Particles: a scatter of grains, bigger low down
const particle = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><circle cx="6.5" cy="17" r="2"/><circle cx="12.5" cy="18.5" r="2"/><circle cx="18" cy="16" r="2"/><circle cx="9.5" cy="12" r="1.5"/><circle cx="15.5" cy="10.5" r="1.5"/><circle cx="7" cy="6.5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="18" cy="5.5" r="1"/></g></svg>`;
// File (as grid-game-threejs's): a page with its corner folded and two lines of text
const file = drawn('M7.05 4.16h7.01l3.31 3.3v12.38H7.05ZM14.06 4.16v3.3h3.31M9.11 12.41h6.19M9.11 15.72h6.19');
// Shadows: a ball and its shadow on the ground
const shadows = drawn('M15.25 9a4.25 4.25 0 1 1-8.5 0 4.25 4.25 0 0 1 8.5 0ZM4.75 19.25c0 1 3.25 1.75 7.25 1.75s7.25-.75 7.25-1.75-3.25-1.75-7.25-1.75-7.25.75-7.25 1.75Z');
// Liquid surfaces: smooth, a drop; droplets, three of them
const liquidSmooth = drawn('M12 3.25s6.25 6.6 6.25 10.75a6.25 6.25 0 0 1-12.5 0C5.75 9.85 12 3.25 12 3.25Z');
const liquidDrops = drawn('M7.5 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM16.25 9a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0ZM12.75 17.5a2.75 2.75 0 1 1-5.5 0 2.75 2.75 0 0 1 5.5 0ZM21.25 16.25a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z');

// Copy: two sheets, one over the other; Grid: a lattice
const copy = drawn('M8.75 8.75h10.5v10.5H8.75ZM15.25 8.75v-4H4.75v10.5h4');
// a pencil
const pencil = drawn('M15.75 4.75 19.25 8.25 8.5 19H5v-3.5ZM13.25 7.25l3.5 3.5');
const grid = drawn('M4.75 4.75h14.5v14.5H4.75ZM9.6 4.75v14.5M14.4 4.75v14.5M4.75 9.6h14.5M4.75 14.4h14.5');

const ICONS = {
  copy,
  paste: recolour(clipboard),
  delete: recolour(trash),
  gridOn: grid,
  gridOff: struck(grid),
  refractionOn,
  refractionOff,
  shadowsOn: shadows,
  shadowsOff: struck(shadows),
  glowOn: recolour(bulb),
  glowOff: struck(recolour(bulb)),
  detailOn: recolour(layers),
  detailOff: struck(recolour(layers)),
  liquidOn: liquidSmooth,
  liquidOff: liquidDrops,
  particlesHigh: recolour(cloud),
  particlesLow: struck(recolour(cloud)).replace('M3.5 3.5 20.5 20.5', 'M6 18.5 18 18.5'),
  mono: recolour(eye),
  stereo: eyes,
  vr: headset,
  vrOff: headsetOff,
  on: recolour(sun),
  off: recolour(ban),
  solid,
  // (drawn as small as grid-game-threejs's: 65% of the icon's box, not Lineicons' 81%)
  gear: recolour(gear).replace(/viewBox="[^"]*"/, 'viewBox="-2.8 -2.19 29.6 29.6"'),
  edit: pencil,
  skybox: recolour(globe),
  passthrough: recolour(picture),
  rotate: recolour(rotate),
  pause: recolour(pause),
  shape: cube,
  sphere,
  select: recolour(selectCursor),
  play: recolour(play),
  eye: recolour(eye),
  gravity,
  gravityOff,
  file,
  physics,
  particle,
  grains,
  grainsOff: struck(grains),
  particleOff: struck(particle),
  soft,
  softOff: struck(soft),
  jiggle,
  jiggleOff: struck(jiggle),
  fluid: recolour(waterDrop),
  fluidOff: struck(recolour(waterDrop)),
  cloth: recolour(shirt),
  clothOff: struck(recolour(shirt)),
  newScene: recolour(filePlus),
  save: recolour(floppy),
  open: recolour(folder),
  soundOn: recolour(volume),
  soundOff: recolour(volumeMute),
  material,
  // Vibration (as grid-game-threejs's): a controller's handle with buzz lines either side, or still and struck through
  vibrationOn: `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M9.1 4.3h5.8v15.4H9.1ZM5.8 7.7 4.3 10.1l1.5 2.4-1.5 2.4M18.2 7.7l1.5 2.4-1.5 2.4 1.5 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  vibrationOff: `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M9.1 4.3h5.8v15.4H9.1ZM4.3 20.2 19.7 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  reflectionsOn: recolour(sun),
  reflectionsOff: recolour(sun).replace('</svg>', '<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'),
  edges,
  monitor,
  video,
  monitorSbs,
  monitorInterlaced,
  phone,
  phoneViewer,
  faces: recolour(diamond),
  // a dropdown, closed and open, and the chosen option in its list
  dropdown: recolour(chevronDown),
  dropdownOpen: recolour(chevronUp),
  check: recolour(check),
  accessibility,
  textSize,
  xrResolution,
  vsyncOn,
  vsyncOff,
  controllerGuideOn,
  controllerGuideOff,
};

// each shape's own, drawn from its edges (see shapes.js): "shape:<id>"
for (const s of Object.values(SHAPES)) if (s.icon) ICONS[`shape:${s.id}`] = s.icon;

/** An icon as a standalone SVG in a fixed colour, for drawing onto a canvas. */
export function iconSvg(name, color = '#ffffff') {
  return (ICONS[name] ?? '')
    .replace(/currentColor/g, color)
    .replace(/width="1\.25em" height="1\.25em"/, 'width="96" height="96"');
}

export default function Icon({ name }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
