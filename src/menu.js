// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): four groups, File, Physics, Video and Accessibility, each
// opening a list of setting buttons beneath it, each "Name: Value". A
// dropdown opens a list of choices beneath it (a chevron on its right); a
// slider sets a value along its track; the rest toggle when pressed.

import { XR_RESOLUTION } from './xrResolution.js';
import { MATERIALS } from './materials.js';

export const MENU_TITLE = 'Physics Sandbox';

/** The panels' toggle buttons: Options' gear (opens and closes it), the View panel's (into XR or back) and the Tools panel's. */
export const MENU_TOGGLE = 'menu:toggle';
export const VIEW_TOGGLE = 'view:toggle';
export const TOOLS_TOGGLE = 'tools:toggle';

/** The tools, in the Tools dropdown: Select picks objects up; Cube and Sphere make one where you click. */
export const TOOLS = [
  { value: 'select', label: 'Select', icon: 'select' },
  { value: 'cube', label: 'Cube', icon: 'shape' },
  { value: 'sphere', label: 'Sphere', icon: 'sphere' },
];

/** The Material dropdown's choices: Random (a solid or liquid one each time), then the table's, in its order. */
export const MATERIAL_CHOICES = [{ value: 'random', label: 'Random' }, ...MATERIALS.map((m) => ({ value: m.id, label: m.name }))];

/**
 * The panels, one template for both renderers (the windowed one in App.jsx,
 * the XR one in XRMenuPanel.jsx), stacked top to bottom: each { id, toggle:
 * { id, icon, label }, title, status?, open, items, labels? } (items and
 * labels: see menuItems, possibleLabels). Closed, a panel shows only its
 * toggle button, top left; open, the title beside it and its items beneath.
 *
 * Options: the gear, the title, the XR status line, the menu. `menu`: { open,
 * status, items, labels }.
 */
export function optionsPanel(menu) {
  return {
    id: 'options',
    toggle: { id: MENU_TOGGLE, icon: 'gear', label: menu.open ? 'Hide options' : 'Show options' },
    title: MENU_TITLE,
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
 * use and the material the Cube and Sphere tools make things of.
 * `state`: { toolsOpen, tool, material, dropdowns }.
 */
export function toolsPanel(state) {
  const tool = TOOLS.find((t) => t.value === state.tool) ?? TOOLS[0];
  const material = MATERIAL_CHOICES.find((m) => m.value === state.material) ?? MATERIAL_CHOICES[0];
  const items = [
    { id: 'tool', label: `Tool: ${tool.label}`, icon: tool.icon, dropdown: dropdown(state, 'tool', TOOLS, state.tool) },
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
    group('file', 'File', 'file', ['save', 'open']),
    group('physics', 'Physics', 'gravity', ['gravity', 'simulation', 'sound', 'reset']),
    group('video', 'Video', 'video', ['background', 'view', 'vsync', 'xrResolution']),
    group('accessibility', 'Accessibility', 'accessibility', ['textSize', 'controllerGuide']),
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
    { id: 'save', label: 'Save Scene (.glb)', icon: 'save', title: 'Download the scene as glTF, which Blender imports (File → Import → glTF 2.0)' },
    { id: 'open', label: 'Open Scene (.glb)', icon: 'open', title: 'Load a scene saved here, or one from Blender that kept its custom properties' },
    {
      id: 'sound',
      label: `Sound: ${state.sound ? 'On' : 'Off'}`,
      icon: state.sound ? 'soundOn' : 'soundOff',
      title: 'Objects striking and sliding on each other, sounding like what they are made of',
    },
    { id: 'reset', label: 'Reset Objects', icon: 'rotate', title: 'The ten starting cubes dropped onto the disc again; the objects made are cleared' },
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
        for (const item of Object.values(settingsById({ gravity: flag, paused: flag, sound: flag, background, view, dropdowns: [], textSize: 1, controllerGuide: flag, vsync: flag, xrResolution: 1, xrResolutionActive: null }, env)))
          labels.add(item.label);
  // the sliders' widest values, and Controller Guide both ways
  labels.add(`Text Size: ${percent(TEXT_SIZE.max)}`);
  labels.add(`XR Resolution: ${percent(XR_RESOLUTION.max)} (on release)`);
  for (const flag of [false, true]) {
    labels.add(`Controller Guide: ${flag ? 'On' : 'Off'}`);
    labels.add(`VSync: ${flag ? 'On' : 'Off'}`);
  }
  return [...labels];
}
