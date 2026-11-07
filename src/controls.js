// What each input does here, for Options → Controls (controlsGuide.js draws it) and the
// XR Control Guides (ControllerGuide.jsx labels the controllers with XR_CONTROLS).

/** XR controllers: what each part does, by hand; the XR Control Guides' labels too. */
const GRIP = 'Hold: pick up what the probe\ntouches or you point at, or a menu\nOn what the other holds: turn, resize\nBoth in mid-air: scale the scene\nTap twice: dock / undock\nTap 3 times: menus here';
const TRIGGER = 'Point and press\nSelect: drag an object\nA shape: make one\nResizing: stretch along the hands\' line';
export const XR_CONTROLS = {
  left: {
    'xr-standard-trigger': TRIGGER,
    'xr-standard-squeeze': GRIP,
    'xr-standard-thumbstick': 'Fly (where it points)\nPointing at a menu: scroll it\nIts menu pointed at: step through\nPress: this hand\'s menus / back\nGripping: push / pull, roll',
    'x-button': 'In menus: choose',
    'y-button': 'In menus: back a level',
  },
  right: {
    'xr-standard-trigger': TRIGGER,
    'xr-standard-squeeze': GRIP,
    'xr-standard-thumbstick': 'Turn; up / down: rise, sink\nPointing at a menu: scroll it\nIts menu pointed at: step through\nPress: this hand\'s menus / back\nGripping: push / pull, roll',
    'a-button': 'In menus: choose',
    'b-button': 'In menus: back a level',
  },
};
/** Each input's controls (see controlsGuide.js): no gamepad controls yet. */
export const CONTROLS = {
  mk: {
    mouse: {
      left: 'Drag: orbit\nClick: use the tool\nSelect: drag an object, let go moving to throw it',
      middle: 'Drag: pick up and throw (any tool)',
      wheel: 'Zoom\nHolding: nearer / further',
      right: 'Drag: pan',
    },
    keys: [
      { keys: ['1', '–', '9', '/', '0'], action: 'Tools, in order' },
      { keys: ['G'], action: 'Gravity on / off' },
      { keys: ['P'], action: 'Pause / resume' },
      { keys: ['R'], action: 'Reset the objects' },
      { keys: ['M'], action: 'Mute / unmute' },
      { keys: ['Enter', '/', 'Esc'], action: 'Options' },
    ],
  },
  pad: null,
  xr: XR_CONTROLS,
};
