// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): four groups, File, Physics, Video and Accessibility, each
// opening a list of setting buttons beneath it, each "Name: Value". A
// dropdown opens a list of choices beneath it (a chevron on its right); a
// slider sets a value along its track; the rest toggle when pressed.

import { XR_RESOLUTION } from './xrResolution.js';
import { MATERIALS } from './materials.js';
import { SHAPES } from './shapes.js';

export const MENU_TITLE = 'Physics Sandbox';

/** The panels' toggle buttons: Options' gear (opens and closes it), the View panel's (into XR or back) and the Tools panel's. */
export const MENU_TOGGLE = 'menu:toggle';
export const VIEW_TOGGLE = 'view:toggle';
export const TOOLS_TOGGLE = 'tools:toggle';
/** Options' corner, the scene scale: pressed, back to real size. */
export const SCALE_RESET = 'scale:reset';

/**
 * The tools, in the Tools dropdown: Select picks objects up; Copy takes an
 * object (its shape, material and size), Paste makes another like it, Delete
 * takes one away; each shape (see shapes.js) makes one where you click.
 */
export const TOOLS = [
  { value: 'select', label: 'Select', icon: 'select' },
  { value: 'copy', label: 'Copy', icon: 'copy' },
  { value: 'paste', label: 'Paste', icon: 'paste' },
  { value: 'delete', label: 'Delete', icon: 'delete' },
  ...Object.values(SHAPES).map((s) => ({ value: s.id, label: s.label, icon: s.id === 'cube' ? 'shape' : s.id === 'sphere' ? 'sphere' : `shape:${s.id}` })),
];

/** The scene scale as shown: ×1 is real size. */
export function scaleLabel(scale) {
  return `×${scale >= 10 ? scale.toFixed(1) : scale >= 0.995 ? scale.toFixed(2) : scale.toFixed(3)}`;
}

/** The Material dropdown's choices: Random (a solid or liquid one each time), then the table's, in its order. */
export const MATERIAL_CHOICES = [{ value: 'random', label: 'Random' }, ...MATERIALS.map((m) => ({ value: m.id, label: m.name }))];

/**
 * The panels, one template for both renderers (the windowed one in App.jsx,
 * the XR one in XRMenuPanel.jsx), stacked top to bottom: each { id, toggle:
 * { id, icon, label }, title, corner?, status?, open, items, labels? } (items and
 * labels: see menuItems, possibleLabels). Closed, a panel shows only its
 * toggle button, top left; open, the title beside it, `corner` ({ id,
 * label, title, widest }: a small button) in the top-right corner, and its items beneath.
 *
 * Options: the gear, the title, the scene scale, the XR status line, the
 * menu. `menu`: { open, status, items, labels, scale }.
 */
export function optionsPanel({ scale, ...menu }) {
  return {
    id: 'options',
    toggle: { id: MENU_TOGGLE, icon: 'gear', label: menu.open ? 'Hide options' : 'Show options' },
    title: MENU_TITLE,
    corner: {
      id: SCALE_RESET,
      label: scaleLabel(scale),
      title: scale === 1 ? 'Scene scale: real size. In XR, hold both grips in mid-air and move your hands apart or together to scale it' : 'Scene scale. Press for real size',
      widest: scaleLabel(0.051),
    },
    ...menu,
  };
}

/**
 * The View panel, as in grid-game-threejs: one button, never opened, that
 * switches between the Normal view and XR: HMD Stereo, showing the one it
 * switches to (outside XR the headset, in XR the monitor).
 */
export function viewPanel(inXR) {
  const label = inXR ? 'Normal view' : 'XR: HMD Stereo';
  return { id: 'view', toggle: { id: VIEW_TOGGLE, icon: inXR ? 'monitor' : 'vr', label }, title: label, open: false, items: [] };
}

/**
 * The Tools panel, like grid-game-threejs's Control menu (windowed in the
 * top-right corner; in XR on the right controller): two dropdowns, the tool in
 * use and the material the shape tools make things of.
 * `state`: { toolsOpen, tool, material, clip (what Copy took, if anything), dropdowns }.
 */
export function toolsPanel(state) {
  const tool = TOOLS.find((t) => t.value === state.tool) ?? TOOLS[0];
  const material = MATERIAL_CHOICES.find((m) => m.value === state.material) ?? MATERIAL_CHOICES[0];
  // (Paste: nothing to paste until something's copied)
  const tools = TOOLS.map((t) => (t.value === 'paste' && !state.clip ? { ...t, disabled: true, title: 'Copy an object first' } : t));
  const items = [
    { id: 'tool', label: `Tool: ${tool.label}`, icon: tool.icon, dropdown: dropdown(state, 'tool', tools, state.tool) },
    {
      id: 'material',
      label: `Material: ${material.label}`,
      icon: 'material',
      dropdown: dropdown(state, 'material', MATERIAL_CHOICES, material.value),
      title: 'What Cube and Sphere make things of',
    },
  ];
  return {
    id: 'tools',
    toggle: { id: TOOLS_TOGGLE, icon: 'eye', label: state.toolsOpen ? 'Hide tools' : 'Show tools' },
    title: 'Tools',
    open: state.toolsOpen,
    items,
    labels: [...TOOLS.map((t) => `Tool: ${t.label}`), ...MATERIAL_CHOICES.map((m) => `Material: ${m.label}`)],
  };
}

/** Options → Background, in list order (passthrough last). */
export const BACKGROUNDS = ['solid', 'skybox', 'passthrough'];
const BACKGROUND_LABELS = { solid: 'Solid', skybox: 'Skybox', passthrough: 'Passthrough (XR Only)' };

/** The Vite + React starter's page colour, used for the Solid background. */
export const SOLID_BACKGROUND = '#242424';

/**
 * Options → View, in list order. Normal and the 3D views are windowed; the
 * rest are XR sessions. Phones get the phone views, headsets the HMD one.
 */
export const VIEWS = ['normal', 'sbs', 'interlaced', 'hmd', 'phoneAR', 'phoneViewer'];
export const XR_VIEWS = ['hmd', 'phoneAR', 'phoneViewer'];
const VIEW_LABELS = {
  normal: 'Normal',
  sbs: '3D: SBS',
  interlaced: '3D: Interlaced',
  hmd: 'XR: HMD Stereo',
  phoneAR: 'XR: Phone AR',
  phoneViewer: 'XR: Phone Viewer',
};
const VIEW_ICONS = { normal: 'monitor', sbs: 'monitorSbs', interlaced: 'monitorInterlaced', hmd: 'vr', phoneAR: 'phone', phoneViewer: 'phoneViewer' };

/**
 * The views this device can show. `env`: { phone, headset, xrSupported }.
 * A headset browser's own window can't show the 3D views usefully, so not there.
 */
export function availableViews(env) {
  return VIEWS.filter((view) => {
    if (view === 'sbs' || view === 'interlaced') return !env.headset;
    if (view === 'hmd') return !env.phone && env.xrSupported;
    if (view === 'phoneAR' || view === 'phoneViewer') return env.phone;
    return true;
  });
}

/**
 * A label's setting name and its value, split at the first ": ". The panels
 * draw the name on the left and the value against the right edge.
 */
export function splitLabel(label) {
  const at = label.indexOf(': ');
  return at < 0 ? { name: label, value: '' } : { name: label.slice(0, at), value: label.slice(at + 2) };
}

export const PICK_PREFIX = 'pick:';

/** Accessibility → Volume: the sounds, 0 (off) to 100% (as grid-game-threejs's Sounds). */
export const VOLUME = Object.freeze({ min: 0, max: 1, step: 0.1, default: 1 });
/** Accessibility → Vibration: every buzz's strength, 0 (off) to 200% (above 100%: stronger, up to the controller's most; as in grid-game-threejs). */
export const VIBRATION = Object.freeze({ min: 0, max: 2, step: 0.1, default: 1 });

/** Accessibility → Text Size: a multiplier on the panels' text and icons, 75% to 200% (as in grid-game-threejs). */
export const TEXT_SIZE = Object.freeze({ min: 0.75, max: 2, step: 0.25, default: 1 });

/** `value` within `spec` ({ min, max, step, default }), snapped to its steps. */
export function snapToSlider(spec, value) {
  const n = value == null || value === '' ? NaN : Number(value); // (nothing saved: the default, not 0)
  const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(n) ? n : spec.default));
  return +(Math.round(v / spec.step) * spec.step).toFixed(4);
}

const SLIDE_PREFIX = 'slide:';
const SLIDE_END_PREFIX = 'slideEnd:';
/** The id a slider sends to set `value`: "slide:<id>=<value>" (a pointer's press or drag, the gaze's stare). */
export const slideId = (id, value) => `${SLIDE_PREFIX}${id}=${value}`;
/** A "slide:<id>=<value>" id's { id, value }, or null for any other id. */
export function parseSlide(slide) {
  if (!slide?.startsWith(SLIDE_PREFIX)) return null;
  const [id, value] = slide.slice(SLIDE_PREFIX.length).split('=');
  return { id, value: Number(value) };
}
/** The id a slider sends when it's let go ("slideEnd:<id>"), and back: the slider's id, or null. */
export const slideEndId = (id) => `${SLIDE_END_PREFIX}${id}`;
export const parseSlideEnd = (id) => (id?.startsWith(SLIDE_END_PREFIX) ? id.slice(SLIDE_END_PREFIX.length) : null);

const percent = (v) => `${Math.round(v * 100)}%`;

/**
 * A dropdown: the button shows the current choice, and when it is open
 * (in `state.dropdowns`), lists every choice beneath it. `choices`:
 * [{ value, label, icon?, disabled?, title? }]. Choosing one sends "pick:<id>:<index>".
 */
function dropdown(state, id, choices, current) {
  return {
    open: state.dropdowns.includes(id),
    options: choices.map((choice, i) => ({ ...choice, id: `${PICK_PREFIX}${id}:${i}`, selected: choice.value === current })),
  };
}

/** Every setting in `items`, the ones inside groups included. */
export function settingItems(items) {
  return items.flatMap((item) => (item.group ? item.group.items : [item]));
}

/** The dropdown choice a "pick:<id>:<index>" id names, from `items`: { id, value } or null. */
export function pickedChoice(items, pickId) {
  const [id, index] = pickId.slice(PICK_PREFIX.length).split(':');
  const option = settingItems(items).find((item) => item.id === id)?.dropdown?.options[Number(index)];
  return option && !option.disabled ? { id, value: option.value } : null;
}

/**
 * Items: the groups File, Physics, Video and Accessibility, { id, label, icon, group: { open, items } },
 * which, when open (in `state.groups`), list their settings beneath, indented like
 * a dropdown's choices. Settings: { id, label ("Name: Value", see splitLabel),
 * icon, disabled?, title?, dropdown?, slider? }. `slider`: { min, max, step, value }. `dropdown`: { open, options: [{ id,
 * label, value, selected, icon?, disabled?, title? }] }, drawn with a chevron at the
 * far right and, when open, its options beneath. `env`: { passthroughAvailable,
 * views (available), phone, checking }.
 */
export function menuItems(state, env) {
  const settings = settingsById(state, env);
  const group = (id, label, icon, ids) => ({
    id,
    label,
    icon,
    group: { open: state.groups.includes(id), items: ids.map((setting) => settings[setting]) },
  });
  return [
    group('file', 'File', 'file', ['new', 'save', 'open']),
    group('physics', 'Physics', 'gravity', ['gravity', 'simulation', 'reset']),
    group('video', 'Video', 'video', ['background', 'view', 'grid', 'reflections', 'refraction', 'shadows', 'glowLights', 'surfaceDetail', 'liquidSurfaces', 'particles', 'vsync', 'xrResolution']),
    group('accessibility', 'Accessibility', 'accessibility', ['volume', 'vibration', 'textSize', 'controllerGuide']),
  ];
}

function settingsById(state, env) {
  const xrMissing = !env.views.some((view) => XR_VIEWS.includes(view));
  const items = [
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      dropdown: dropdown(
        state,
        'background',
        BACKGROUNDS.map((b) => {
          const unavailable = b === 'passthrough' && !env.passthroughAvailable;
          return {
            value: b,
            label: BACKGROUND_LABELS[b],
            disabled: unavailable,
            title: unavailable ? 'Passthrough needs an XR headset or a phone camera' : undefined,
          };
        }),
        state.background,
      ),
    },
    {
      id: 'view',
      label: `View Mode: ${VIEW_LABELS[state.view]}`,
      icon: VIEW_ICONS[state.view],
      // every view, the ones this device can't show disabled
      dropdown: dropdown(
        state,
        'view',
        VIEWS.map((view) => {
          const unavailable = !env.views.includes(view);
          return {
            value: view,
            label: VIEW_LABELS[view],
            icon: VIEW_ICONS[view],
            disabled: unavailable,
            title: unavailable ? viewUnavailableReason(view, env) : undefined,
          };
        }),
        state.view,
      ),
      title: xrMissing && !env.checking ? "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR." : undefined,
    },
    { id: 'gravity', label: `Gravity: ${state.gravity ? 'On' : 'Off'}`, icon: state.gravity ? 'gravity' : 'gravityOff', title: 'Off: objects float where they are let go' },
    { id: 'simulation', label: `Simulation: ${state.paused ? 'Paused' : 'Running'}`, icon: state.paused ? 'pause' : 'play' },
    { id: 'new', label: 'New Scene', icon: 'newScene', title: 'Clear the disc: every object gone (Physics → Reset Objects brings back the ten cubes)' },
    { id: 'save', label: 'Save Scene (.glb)', icon: 'save', title: 'Download the scene as glTF, which Blender imports (File → Import → glTF 2.0)' },
    { id: 'open', label: 'Open Scene (.glb)', icon: 'open', title: 'Load a scene saved here, or one from Blender that kept its custom properties' },
    {
      id: 'volume',
      label: `Volume: ${state.volume > 0 ? percent(state.volume) : 'Off'}`,
      icon: state.volume > 0 ? 'soundOn' : 'soundOff',
      slider: { ...VOLUME, value: state.volume },
      title: 'Objects striking and sliding on each other, sounding like what they are made of (M: mute)',
    },
    {
      id: 'vibration',
      label: `Vibration: ${state.vibration > 0 ? percent(state.vibration) : 'Off'}`,
      icon: state.vibration > 0 ? 'vibrationOn' : 'vibrationOff',
      slider: { ...VIBRATION, value: state.vibration },
      title: "The controllers' buzz: touching, picking up and striking things (above 100%: stronger)",
    },
    { id: 'reset', label: 'Reset Objects', icon: 'rotate', title: 'The ten starting cubes dropped onto the disc again; the objects made are cleared' },
    {
      id: 'reflections',
      label: `Reflections: ${state.reflections ? 'On' : 'Off'}`,
      icon: state.reflections ? 'reflectionsOn' : 'reflectionsOff',
      title: 'On: objects mirror their surroundings, metals most. Off: lit by the lights alone (faster)',
    },
    {
      id: 'grid',
      label: `Show Grid: ${state.grid ? 'On' : 'Off'}`,
      icon: state.grid ? 'gridOn' : 'gridOff',
      title: 'Thin grey lines every 10 cm through the space over the disc, up to 2 m: to judge sizes and distances',
    },
    // the effects that cost the most, each to be turned down where frames run short (in XR most of all)
    {
      id: 'refraction',
      label: `Refraction: ${state.refraction ? 'On' : 'Off'}`,
      icon: state.refraction ? 'refractionOn' : 'refractionOff',
      title: 'On: glass, water, ice and the like bend what is seen through them, by their index of refraction. Off: plainly see-through (faster)',
    },
    {
      id: 'shadows',
      label: `Shadows: ${state.shadows ? 'On' : 'Off'}`,
      icon: state.shadows ? 'shadowsOn' : 'shadowsOff',
      title: "The sun's shadows (faster off)",
    },
    {
      id: 'glowLights',
      label: `Glow Lights: ${state.glowLights ? 'On' : 'Off'}`,
      icon: state.glowLights ? 'glowOn' : 'glowOff',
      title: 'Glowing things (lava, fire, kryptonite...) light what is around them. Off: they still glow (faster)',
    },
    {
      id: 'surfaceDetail',
      label: `Surface Detail: ${state.surfaceDetail ? 'On' : 'Off'}`,
      icon: state.surfaceDetail ? 'detailOn' : 'detailOff',
      title: "The materials' bumps and patches of shine (grain, hammering, cracks...). Off: smooth (faster)",
    },
    {
      id: 'liquidSurfaces',
      label: `Liquid Surfaces: ${state.liquidSurfaces ? 'Smooth' : 'Droplets'}`,
      icon: state.liquidSurfaces ? 'liquidOn' : 'liquidOff',
      title: 'Smooth: a liquid drawn as one surface round its droplets (metaballs). Droplets: each drawn as a drop (faster)',
    },
    {
      id: 'particles',
      label: `Particles: ${state.particles === 'low' ? 'Low' : 'High'}`,
      icon: state.particles === 'low' ? 'particlesLow' : 'particlesHigh',
      title: 'How much smoke, steam, fire, fog, sparks and dust (Low: about a third)',
    },
    {
      id: 'vsync',
      label: `VSync: ${state.vsync ? 'On' : 'Off'}`,
      icon: state.vsync ? 'vsyncOn' : 'vsyncOff',
      title: 'On: a frame per display refresh. Off: frames as fast as they can be drawn (not in XR)',
    },
    {
      id: 'xrResolution',
      // (fixed when an XR session starts: changed during one, the session starts again when the slider's let go)
      label: `XR Resolution: ${percent(state.xrResolution)}${state.xrResolutionActive != null && state.xrResolution !== state.xrResolutionActive ? ' (on release)' : ''}`,
      icon: 'xrResolution',
      slider: { ...XR_RESOLUTION, value: state.xrResolution },
      title: "The headset's resolution: lower draws faster",
    },
    {
      id: 'textSize',
      label: `Text Size: ${percent(state.textSize)}`,
      icon: 'textSize',
      slider: { ...TEXT_SIZE, value: state.textSize },
    },
    {
      id: 'controllerGuide',
      label: `Controller Guide: ${state.controllerGuide ? 'On' : 'Off'}`,
      icon: state.controllerGuide ? 'controllerGuideOn' : 'controllerGuideOff',
      title: "In XR, labels beside the controllers' buttons saying what they do",
    },
  ];
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/** Why this device can't show `view` (see availableViews). */
function viewUnavailableReason(view, env) {
  if (view === 'sbs' || view === 'interlaced') return "A headset's browser can't show the 3D views";
  if (view === 'phoneAR' || view === 'phoneViewer') return 'Needs a phone';
  if (env.phone) return 'Needs a headset';
  return env.checking ? 'Checking for WebXR…' : "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR.";
}

/**
 * Every label the settings can show in this environment, so both panels can
 * size themselves to the widest one and not change width as values change.
 * (The groups' labels are short, so they don't set it; the panels also fit
 * the dropdowns' choices, two to a row.)
 */
export function possibleLabels(env) {
  const labels = new Set();
  const backgrounds = BACKGROUNDS.filter((b) => b !== 'passthrough' || env.passthroughAvailable);
  for (const flag of [false, true])
    for (const background of backgrounds)
      for (const view of env.views)
        for (const item of Object.values(settingsById({ gravity: flag, paused: flag, grid: flag, reflections: flag, refraction: flag, shadows: flag, glowLights: flag, surfaceDetail: flag, liquidSurfaces: flag, particles: flag ? 'high' : 'low', volume: 1, vibration: 1, background, view, dropdowns: [], textSize: 1, controllerGuide: flag, vsync: flag, xrResolution: 1, xrResolutionActive: null }, env)))
          labels.add(item.label);
  // the sliders' widest values, and Controller Guide both ways
  labels.add(`Text Size: ${percent(TEXT_SIZE.max)}`);
  labels.add(`Volume: ${percent(VOLUME.max)}`);
  labels.add(`Vibration: ${percent(VIBRATION.max)}`);
  labels.add(`XR Resolution: ${percent(XR_RESOLUTION.max)} (on release)`);
  for (const flag of [false, true]) {
    labels.add(`Controller Guide: ${flag ? 'On' : 'Off'}`);
    labels.add(`VSync: ${flag ? 'On' : 'Off'}`);
  }
  return [...labels];
}
