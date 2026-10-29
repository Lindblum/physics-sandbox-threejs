import { Fragment, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import Icon from './Icon.jsx';
import { phoneARSessionInit } from './PhoneStereo.jsx';
import { XR_RESOLUTION, setXRViewportScale } from './xrResolution.js';
import { CardboardOverlay, canUseCardboard, enterCardboard, exitCardboard } from './Cardboard.jsx';
import { startingBodies } from './Physics.jsx';
import { openScene, saveScene } from './sceneFile.js';
import { initSound, setVolume, wakeSoundInXR } from './sound.js';
import { setVibration } from './grip.js';
import {
  MENU_TOGGLE,
  PICK_PREFIX,
  MATERIAL_CHOICES,
  SCALE_RESET,
  TOOLS,
  TOOLS_TOGGLE,
  VIEW_TOGGLE,
  TEXT_SIZE,
  splitLabel,
  XR_VIEWS,
  availableViews,
  menuItems,
  optionsPanel,
  parseSlide,
  parseSlideEnd,
  pickedChoice,
  possibleLabels,
  settingItems,
  slideEndId,
  slideId,
  snapToSlider,
  VIBRATION,
  VOLUME,
  toolsPanel,
  viewPanel,
} from './menu.js';

// How the display settings work:
//   Background (Solid / Skybox / Passthrough): what is behind the disc. Changes live.
//   View: picks from the views this device supports (see menu.js):
//     Normal, 3D: SBS (half side-by-side, for 3D TVs) and 3D: Interlaced
//     (alternate rows, for passive 3D monitors) are windowed.
//     The XR views start a session, only from a tap, as browsers require.
//
// XR: HMD Stereo (headsets) starts an AR session where supported (so every
// background, passthrough included, can be switched live), otherwise VR.
// XR: Phone AR / Phone Viewer start one AR session (tracked by ARCore) that
// the app draws as one view, or two lens-corrected eyes for a phone viewer;
// switching between the two is live. Phones without AR get a view steered by
// the motion sensors instead, with the rear camera for passthrough.

// kept as a reference: the store reads it whenever a session starts
const xrOptions = {
  // controllers and hands get ray / touch pointers by default; the grips pick
  // up objects and panels themselves (see Grab.jsx), so no grab pointers on the controllers
  controller: { grabPointer: false },
  frameRate: 'high',
  // headset emulator on localhost during development only
  emulate: import.meta.env.DEV ? 'metaQuest3' : false,
  foveation: 0.5,
  frameBufferScaling: undefined, // Options → Video → XR Resolution, set as each session starts (see enterXR)
};
const store = createXRStore(xrOptions);

/**
 * The phone AR session: the library's defaults plus raw camera access, for
 * passthrough in stereo, and the store's DOM overlay, for the menu in Phone AR.
 */
function enterPhoneAR() {
  xrOptions.customSessionInit = phoneARSessionInit(store.getState().domOverlayRoot);
  try {
    return store.enterAR(); // session options are built synchronously here
  } finally {
    xrOptions.customSessionInit = undefined;
  }
}

/**
 * Phones and tablets, whose WebXR shows a single view. Detected by the
 * device rather than by WebXR support: some phone browsers also report VR.
 */
function isPhone() {
  if (isHeadsetBrowser()) return false;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && canUseCardboard();
}

/** A headset's own browser (Quest, Pico, Wolvic). */
function isHeadsetBrowser() {
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
}

// `list` with `id` added, or taken out if it was there
const toggleIn = (id) => (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Accessibility settings and XR Resolution are remembered in this browser
const TOOLS_KEY = 'physics-sandbox.tools';
const REFLECTIONS_KEY = 'physics-sandbox.reflections';
const EFFECTS_KEY = 'physics-sandbox.effects';

/**
 * Video's costly effects, as last left: { refraction, shadows, glowLights,
 * surfaceDetail, liquidSurfaces (metaballs), particles ('high' / 'low') }.
 * At first all on, but Refraction off in a headset (it draws the scene again).
 */
function loadEffects() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(EFFECTS_KEY)) ?? {};
  } catch {
    // (the defaults)
  }
  const flag = (key, fallback) => (typeof saved[key] === 'boolean' ? saved[key] : fallback);
  return {
    refraction: flag('refraction', !isHeadsetBrowser()),
    shadows: flag('shadows', true),
    glowLights: flag('glowLights', true),
    surfaceDetail: flag('surfaceDetail', true),
    liquidSurfaces: flag('liquidSurfaces', true),
    grid: flag('grid', false),
    particles: saved.particles === 'low' ? 'low' : 'high',
  };
}

function loadReflections() {
  try {
    return JSON.parse(localStorage.getItem(REFLECTIONS_KEY)) !== false;
  } catch {
    return true;
  }
}

const ACCESSIBILITY_KEY = 'physics-sandbox.accessibility';
const XR_RESOLUTION_KEY = 'physics-sandbox.xrResolution';
const VSYNC_KEY = 'physics-sandbox.vsync';

function loadVSync() {
  try {
    return JSON.parse(localStorage.getItem(VSYNC_KEY)) !== false;
  } catch {
    return true;
  }
}

function loadXRResolution() {
  try {
    return snapToSlider(XR_RESOLUTION, JSON.parse(localStorage.getItem(XR_RESOLUTION_KEY)));
  } catch {
    return XR_RESOLUTION.default;
  }
}

/** The Tools panel: { tool, material, open }, as last left. */
function loadTools() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(TOOLS_KEY)) ?? {};
  } catch {
    // (the defaults)
  }
  return {
    tool: TOOLS.some((t) => t.value === saved.tool) ? saved.tool : 'select',
    material: MATERIAL_CHOICES.some((m) => m.value === saved.material) ? saved.material : 'random',
    open: saved.open !== false,
  };
}

function loadAccessibility() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY)) ?? {};
  } catch {
    // (storage blocked or unreadable: the defaults)
  }
  return {
    volume: snapToSlider(VOLUME, saved.volume),
    vibration: snapToSlider(VIBRATION, saved.vibration),
    textSize: snapToSlider(TEXT_SIZE, saved.textSize),
    controllerGuide: saved.controllerGuide === true,
  };
}

function useViewerState() {
  const [bodies, setBodies] = useState(startingBodies); // the objects (see Physics.jsx)
  const [gravity, setGravity] = useState(true);
  const [background, setBackground] = useState('skybox'); // 'solid' | 'skybox' | 'passthrough'
  const [screenView, setScreenView] = useState('normal'); // outside XR: 'normal' | 'sbs' | 'interlaced'
  const [phoneStereo, setPhoneStereo] = useState(true); // phone XR: two lens-corrected eyes
  const [handheld, setHandheld] = useState(false); // the motion-sensor view is showing (phones without AR)
  const [paused, setPaused] = useState(false); // the simulation
  const [keepXRPose, setKeepXRPose] = useState(false); // the XR session is starting again (XR Resolution)
  const [menuOpen, setMenuOpen] = useState(true); // shared by the windowed and XR panels
  const [tools, setTools] = useState(loadTools); // the Tools panel: { tool, material, open }, likewise
  const [reflections, setReflections] = useState(loadReflections); // Options → Video → Reflections
  useEffect(() => {
    try {
      localStorage.setItem(REFLECTIONS_KEY, JSON.stringify(reflections));
    } catch {
      // (not remembered)
    }
  }, [reflections]);
  const [effects, setEffects] = useState(loadEffects); // Options → Video's costly effects (see loadEffects)
  useEffect(() => {
    try {
      localStorage.setItem(EFFECTS_KEY, JSON.stringify(effects));
    } catch {
      // (not remembered)
    }
  }, [effects]);
  const [clip, setClip] = useState(null); // what the Copy tool took: { shape, material, transform?, fluid?, name }
  const [sceneScale, setSceneScale] = useState(1); // XR: both grips in mid-air scale it (see Grab.jsx)
  const [scaleReset, setScaleReset] = useState(0); // counts presses of the scale, each one back to real size
  useEffect(() => {
    try {
      localStorage.setItem(TOOLS_KEY, JSON.stringify(tools));
    } catch {
      // (not remembered)
    }
  }, [tools]);
  const [groups, setGroups] = useState([]); // the groups (Physics / Video / Accessibility) whose settings are open, likewise
  const [dropdowns, setDropdowns] = useState([]); // the dropdowns whose lists are open, likewise
  const [accessibility, setAccessibility] = useState(loadAccessibility); // { volume, vibration, textSize, controllerGuide }
  useEffect(() => setVolume(accessibility.volume), [accessibility.volume]);
  useEffect(() => setVibration(accessibility.vibration), [accessibility.vibration]);
  const unmutedVolume = useRef(VOLUME.default); // (M: muted, then back to this)
  useEffect(() => {
    try {
      localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(accessibility));
    } catch {
      // (not remembered)
    }
  }, [accessibility]);
  const [vsync, setVSync] = useState(loadVSync); // Options → Video → VSync (see FramePacing)
  useEffect(() => {
    try {
      localStorage.setItem(VSYNC_KEY, JSON.stringify(vsync));
    } catch {
      // (not remembered)
    }
  }, [vsync]);
  const [xrResolution, setXRResolution] = useState(loadXRResolution);
  const [xrResolutionActive, setXRResolutionActive] = useState(null); // the XR session's own (fixed when it starts), while in one
  useEffect(() => {
    try {
      localStorage.setItem(XR_RESOLUTION_KEY, JSON.stringify(xrResolution));
    } catch {
      // (not remembered)
    }
  }, [xrResolution]);
  // turned down during a session: shown at once, each eye drawn into less of the framebuffer
  useEffect(() => setXRViewportScale(xrResolution, xrResolutionActive), [xrResolution, xrResolutionActive]);
  // Text Size: the windowed panel's text and icons (styles.css --text-scale)
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(accessibility.textSize));
  }, [accessibility.textSize]);

  const actions = useMemo(
    () => ({
      setBodies,
      toggleGravity: () => setGravity((v) => !v),
      setGravity,
      setVolume: (v) => setAccessibility((a) => ({ ...a, volume: snapToSlider(VOLUME, v) })),
      setVibration: (v) => setAccessibility((a) => ({ ...a, vibration: snapToSlider(VIBRATION, v) })),
      toggleMute: () =>
        setAccessibility((a) => {
          if (a.volume > 0) unmutedVolume.current = a.volume;
          return { ...a, volume: a.volume > 0 ? 0 : unmutedVolume.current };
        }),
      toggleReflections: () => setReflections((v) => !v),
      setClip,
      toggleEffect: (id) => setEffects((e) => ({ ...e, [id]: id === 'particles' ? (e.particles === 'low' ? 'high' : 'low') : !e[id] })),
      setSceneScale,
      resetScale: () => setScaleReset((n) => n + 1),
      setMaterial: (material) => setTools((t) => ({ ...t, material })),
      resetBodies: () => setBodies(startingBodies()),
      setTool: (tool) => setTools((t) => ({ ...t, tool })),
      toggleTools: () => setTools((t) => ({ ...t, open: !t.open })),
      setBackground,
      setScreenView,
      setPhoneStereo,
      setHandheld,
      togglePause: () => setPaused((v) => !v),
      toggleMenu: () => {
        setMenuOpen((v) => !v);
        setGroups([]);
        setDropdowns([]);
      },
      // each opens and closes on its own, leaving the others as they are
      toggleGroup: (id) => setGroups(toggleIn(id)),
      toggleDropdown: (id) => setDropdowns(toggleIn(id)),
      closeDropdown: (id) => setDropdowns((list) => list.filter((x) => x !== id)),
      setTextSize: (v) => setAccessibility((a) => ({ ...a, textSize: snapToSlider(TEXT_SIZE, v) })),
      toggleControllerGuide: () => setAccessibility((a) => ({ ...a, controllerGuide: !a.controllerGuide })),
      setXRResolution: (v) => setXRResolution(snapToSlider(XR_RESOLUTION, v)),
      toggleVSync: () => setVSync((v) => !v),
      setXRResolutionActive,
      setKeepXRPose,
    }),
    [],
  );

  const state = {
    bodies,
    gravity,
    tool: tools.tool,
    material: tools.material,
    toolsOpen: tools.open,
    reflections,
    ...effects,
    sceneScale,
    scaleReset,
    clip,
    background,
    passthrough: background === 'passthrough',
    screenView,
    stereo: phoneStereo,
    handheld,
    paused,
    menuOpen,
    groups,
    dropdowns,
    ...accessibility,
    vsync,
    xrResolution,
    xrResolutionActive,
    keepXRPose,
  };
  return [state, actions];
}

function useKeyboard(actions) {
  useEffect(() => {
    const keymap = {
      // 1 to 9, then 0: the tools in order
      ...Object.fromEntries(TOOLS.slice(0, 10).map((t, i) => [`Digit${(i + 1) % 10}`, () => actions.setTool(t.value)])),
      KeyG: actions.toggleGravity,
      KeyP: actions.togglePause,
      KeyR: actions.resetBodies,
      KeyM: actions.toggleMute,
      Enter: actions.toggleMenu,
      NumpadEnter: actions.toggleMenu,
      Escape: actions.toggleMenu,
    };
    const onKey = (e) => {
      if (e.repeat || e.target.closest?.('input, select, textarea')) return;
      const action = keymap[e.code];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}

function useXRSupport() {
  const vr = useXRSessionModeSupported('immersive-vr');
  const ar = useXRSessionModeSupported('immersive-ar');
  return { vr, ar, checked: vr !== undefined || ar !== undefined };
}

const getSessionActive = () => store.getState().session != null;
const getSessionMode = () => store.getState().mode ?? null;
// the browser granted the session's DOM overlay (some don't)
const getDomOverlay = () => store.getState().session?.domOverlayState != null;

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

/** "Name: Value": the name on the left, the value against the right edge. */
function Label({ text }) {
  const { name, value } = splitLabel(text);
  return (
    <span className="label">
      <span className="name">{value ? `${name}:` : name}</span>
      {value && <span className="value">{value}</span>}
    </span>
  );
}

function MenuButtons({ items, labels, onSelect }) {
  return (
    <div className="menu-items">
      <MenuList items={items} onSelect={onSelect} />
      {/* invisible, zero-height copies of every possible label and dropdown
          choice, indented like the settings in a group: they set the panel's width */}
      <div className="menu-sizer menu-group" aria-hidden="true">
        {labels.map((label) => (
          <div key={label} className="menu-btn">
            <Icon name="shape" />
            <Label text={label} />
            <Icon name="dropdown" />
          </div>
        ))}
        <div className="menu-options">
          {settingItems(items).flatMap((item) =>
            (item.dropdown?.options ?? []).map((option) => (
              <div key={option.id} className="menu-option">
                {option.icon && <Icon name={option.icon} />}
                <span className="option-label">{option.label}</span>
                <Icon name="check" />
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

/** Buttons, each followed when open by its group's settings or its dropdown's choices. */
function MenuList({ items, onSelect }) {
  return items.map((item) => {
    const open = (item.group ?? item.dropdown)?.open;
    if (item.slider) {
      // a slider: its button's look, the track beneath the label when there's no room beside it
      const { min, max, step, value } = item.slider;
      return (
        <label key={item.id} className="menu-btn menu-slider" title={item.title}>
          <Icon name={item.icon} />
          <Label text={item.label} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={splitLabel(item.label).name}
            onChange={(e) => onSelect(slideId(item.id, Number(e.target.value)))}
            onPointerUp={() => onSelect(slideEndId(item.id))}
            onKeyUp={() => onSelect(slideEndId(item.id))}
          />
        </label>
      );
    }
    return (
      <Fragment key={item.id}>
        <button
          className="menu-btn"
          disabled={item.disabled}
          title={item.title}
          aria-expanded={item.group || item.dropdown ? open : undefined}
          onClick={() => onSelect(item.id)}
        >
          <Icon name={item.icon} />
          <Label text={item.label} />
          {(item.group || item.dropdown) && <Icon name={open ? 'dropdownOpen' : 'dropdown'} />}
        </button>
        {item.group?.open && (
          <div className="menu-group">
            <MenuList items={item.group.items} onSelect={onSelect} />
          </div>
        )}
        {item.dropdown?.open && (
          <div className="menu-options" role="listbox">
            {item.dropdown.options.map((option) => (
              <button
                key={option.id}
                className={`menu-option${option.selected ? ' selected' : ''}`}
                role="option"
                aria-selected={option.selected}
                disabled={option.disabled}
                title={option.title}
                onClick={() => onSelect(option.id)}
              >
                {option.icon && <Icon name={option.icon} />}
                <span className="option-label">{option.label}</span>
                {option.selected && <Icon name="check" />}
              </button>
            ))}
          </div>
        )}
      </Fragment>
    );
  });
}

/**
 * Calls `onOutside` for a click or tap outside `ref`'s element while
 * `active`. A drag (orbiting the view) isn't a click, so it leaves the
 * menu open. The click still reaches what was under it.
 */
function useClickOutside(ref, active, onOutside) {
  const latest = useRef(onOutside);
  latest.current = onOutside;
  useEffect(() => {
    if (!active) return;
    let down = null;
    const onDown = (e) => {
      // (the other panels, Tools, count as inside too)
      down = ref.current?.contains(e.target) || e.target.closest?.('.hud-stack') ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) latest.current();
      down = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, [ref, active]);
}

/**
 * Page elements shown over a phone's AR session, in the store's DOM overlay
 * (the rest of the page is hidden while it runs). A tap on them stays with
 * them: it doesn't also select in the scene.
 */
function XROverlay({ children }) {
  const wrapper = useRef(null);
  useEffect(() => {
    const el = wrapper.current;
    const keep = (e) => e.preventDefault();
    el?.addEventListener('beforexrselect', keep);
    return () => el?.removeEventListener('beforexrselect', keep);
  }, []);
  const root = store.getState().domOverlayRoot;
  return root ? createPortal(<div ref={wrapper}>{children}</div>, root) : null;
}

/**
 * The windowed panels: draws the panels' template (menu.js optionsPanel,
 * viewPanel; see XRMenuPanel for XR), stacked in the top-left corner.
 * In 3D: SBS each eye gets its own copy, squeezed into its half like the
 * scene, so the display stretches both back into one panel at screen depth.
 * 3D: Interlaced needs nothing: a flat panel already lies on both eyes' rows.
 * `resizable`: a handle at the bottom-right corner sets its width and the
 * height it may grow to (double-click it to fit the buttons again).
 * `panels`: the template's panels, Options first; `onSelect(id)` for their
 * buttons. A click outside them closes Options.
 */
function Hud({ panels, right, onSelect, error, sbs, resizable }) {
  const panel = useRef(null);
  const [size, setSize] = useState(null); // { width, height } dragged to, in px
  useClickOutside(panel, panels[0].open, () => onSelect(MENU_TOGGLE));
  const panelProps = { panels, onSelect, error, size: resizable ? size : null, onResize: resizable ? setSize : null };
  // `right`: the Tools panel, in the top-right corner
  const rightProps = right && { panels: right, onSelect, right: true };
  if (!sbs)
    return (
      <>
        <HudPanel {...panelProps} panelRef={panel} />
        {rightProps && <HudPanel {...rightProps} />}
      </>
    );
  return (
    // one element around both copies: a click in either is inside the menu
    <div className="sbs-eyes" ref={panel}>
      {[0, 1].map((eye) => (
        <div key={eye} className="sbs-eye" aria-hidden={eye === 1 || undefined}>
          <HudPanel {...panelProps} stretch={2} />
          {rightProps && <HudPanel {...rightProps} stretch={2} />}
        </div>
      ))}
    </div>
  );
}

const HUD_MIN_WIDTH = 200;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HUD_MIN_HEIGHT = 120;

/**
 * The bottom-right corner: dragging it resizes the panel. `stretch`: screen
 * px per panel px across, 2 for a copy squeezed into half the screen.
 */
function ResizeHandle({ stretch = 1, onResize }) {
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const hud = handle.closest('.hud');
    const start = { x: e.clientX, y: e.clientY, width: hud.offsetWidth, height: hud.offsetHeight };
    handle.setPointerCapture(e.pointerId);
    const onMove = (m) =>
      onResize({
        width: clamp(start.width + (m.clientX - start.x) * stretch, HUD_MIN_WIDTH, window.innerWidth - 24),
        height: clamp(start.height + m.clientY - start.y, HUD_MIN_HEIGHT, window.innerHeight - 24),
      });
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };
  return <div className="hud-resize" onPointerDown={onPointerDown} onDoubleClick={() => onResize(null)} title="Resize (double-click to fit)" />;
}

/** The panels, top to bottom; `panelRef` on them together. Options (the first) is the resizable one and shows `error`. */
function HudPanel({ panelRef, panels, onSelect, error, size, onResize, stretch, right }) {
  return (
    <div className={`hud-stack${right ? ' hud-stack-right' : ''}`} ref={panelRef}>
      {panels.map((panel, i) => (
        <Panel
          key={panel.id}
          panel={panel}
          onSelect={onSelect}
          error={i === 0 ? error : null}
          size={i === 0 ? size : null}
          onResize={i === 0 ? onResize : null}
          stretch={stretch}
        />
      ))}
    </div>
  );
}

/** One panel of the template: its toggle button, top left; open, its title beside it and its items beneath. */
function Panel({ panel, onSelect, error, size, onResize, stretch }) {
  const { toggle, open } = panel;
  // (a panel with items opens and closes; one without is just its button)
  const button = (
    <button
      className="collapse"
      onClick={() => onSelect(toggle.id)}
      aria-label={toggle.label}
      aria-expanded={panel.items.length ? open : undefined}
      title={toggle.label}
    >
      <Icon name={toggle.icon} />
    </button>
  );
  // collapsed, the panel keeps only its button, which stays where it was
  if (!open) {
    return (
      <aside className="hud collapsed">
        <header>{button}</header>
      </aside>
    );
  }
  return (
    <aside className="hud" style={size ? { '--hud-width': `${size.width}px`, '--hud-height': `${size.height}px` } : undefined}>
      <header>
        {button}
        <h1>{panel.title}</h1>
        {panel.corner && (
          <button className="corner" onClick={() => onSelect(panel.corner.id)} title={panel.corner.title}>
            {panel.corner.label}
          </button>
        )}
      </header>

      <div className="hud-body">
        {panel.status && <p className="stats">{panel.status}</p>}
        <MenuButtons items={panel.items} labels={panel.labels} onSelect={onSelect} />
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
      </div>
      {onResize && <ResizeHandle stretch={stretch} onResize={onResize} />}
    </aside>
  );
}

export default function App() {
  const [viewerState, actions] = useViewerState();
  useKeyboard(actions);
  useEffect(initSound, []);
  // the objects' Rapier bodies, by id (see Physics.jsx): where they are now, for saving
  const registry = useMemo(() => new Map(), []);

  const support = useXRSupport();
  const phone = useMemo(isPhone, []);
  const headset = useMemo(isHeadsetBrowser, []);
  const sessionActive = useSyncExternalStore(store.subscribe, getSessionActive);
  const sessionMode = useSyncExternalStore(store.subscribe, getSessionMode);
  const domOverlay = useSyncExternalStore(store.subscribe, getDomOverlay);
  const inXR = sessionActive || viewerState.handheld;
  const xrSupported = Boolean(support.vr || support.ar);
  const views = useMemo(() => availableViews({ phone, headset, xrSupported }), [phone, headset, xrSupported]);
  // derived from the session, so the panel can never disagree with what is showing
  const view = inXR ? (phone ? (viewerState.stereo ? 'phoneViewer' : 'phoneAR') : 'hmd') : viewerState.screenView;
  const state = { ...viewerState, view };
  const passthroughAvailable = Boolean(support.ar) || phone;
  // Phone AR's single view shows the windowed panel over the scene rather than
  // a panel in it: the motion-sensor view is the page itself, an AR session
  // needs its DOM overlay
  const menuOverlay = phone && inXR && !viewerState.stereo && (viewerState.handheld || domOverlay);
  const [error, setError] = useState(null);

  // into an XR view, straight from the tap, at XR Resolution; whether it started
  const enterXR = async (stereo) => {
    setError(null);
    let label = 'AR';
    xrOptions.frameBufferScaling = state.xrResolution;
    try {
      if (phone && support.ar) await enterPhoneAR();
      else if (phone) {
        enterCardboard({ landscape: stereo }).then((sensors) => {
          if (!sensors) console.warn('[physics-sandbox] motion sensor access denied; the view will not follow the phone');
        });
        actions.setHandheld(true);
      } else if (support.ar) await store.enterAR();
      else {
        label = 'VR';
        await store.enterVR();
      }
    } catch (e) {
      console.error(`[physics-sandbox] could not start ${label}`, e);
      setError(`Couldn't start ${label}: ${describe(e)}`);
      return false;
    }
    if (store.getState().session) actions.setXRResolutionActive(state.xrResolution);
    return true;
  };
  // the session ended: no resolution of its own
  useEffect(() => {
    if (!sessionActive) actions.setXRResolutionActive(null);
  }, [sessionActive, actions]);
  // in XR the controllers' presses wake the sound (the page gets no clicks there)
  useEffect(() => {
    const session = sessionActive && store.getState().session;
    return session ? wakeSoundInXR(session) : undefined;
  }, [sessionActive]);

  /**
   * XR Resolution let go at a new value during a session: the session ends
   * and starts again at it, the objects, the panels and where you stand kept.
   * If the browser won't start one without a fresh tap, the next tap or key
   * anywhere on the page goes back in.
   */
  const restartingXR = useRef(false);
  const [restartWanted, setRestartWanted] = useState(false);
  useEffect(() => {
    if (!restartWanted) return;
    setRestartWanted(false);
    restartXR();
  });
  const restartXR = async () => {
    const session = store.getState().session;
    if (!session || state.handheld || restartingXR.current || state.xrResolution === state.xrResolutionActive) return;
    restartingXR.current = true;
    actions.setKeepXRPose(true);
    try {
      const ended = new Promise((resolve) => session.addEventListener('end', resolve, { once: true }));
      session.end();
      await ended;
      if (await enterXR(state.stereo)) return;
      setError('XR Resolution changed: tap anywhere to go back into XR');
      const back = (e) => {
        window.removeEventListener('pointerup', back, true);
        window.removeEventListener('keydown', back, true);
        if (store.getState().session) return;
        e.preventDefault();
        e.stopPropagation();
        enterXR(state.stereo).finally(() => actions.setKeepXRPose(false));
      };
      window.addEventListener('pointerup', back, true);
      window.addEventListener('keydown', back, true);
    } finally {
      restartingXR.current = false;
      if (store.getState().session) actions.setKeepXRPose(false);
    }
  };
  // out of XR
  const exitXR = () => {
    if (state.handheld) {
      exitCardboard();
      actions.setHandheld(false);
    }
    store.getState().session?.end();
  };

  // the motion-sensor view: stereo wants landscape, mono can be held either way
  useEffect(() => {
    if (!state.handheld) return;
    if (state.stereo) screen.orientation?.lock?.('landscape').catch(() => {});
    else screen.orientation?.unlock?.();
  }, [state.handheld, state.stereo]);
  // leaving fullscreen (back gesture, Esc) also leaves the motion-sensor view
  useEffect(() => {
    if (!state.handheld) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) actions.setHandheld(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [state.handheld, actions]);

  // which XR path is running, shown on the panels
  const status = !inXR
    ? null
    : state.handheld
      ? `XR: motion sensors only (no walking), ${state.stereo ? 'stereo' : 'mono'}`
      : phone
        ? `XR: phone AR, tracked, ${state.stereo ? 'stereo' : 'mono'}`
        : `XR: headset ${sessionMode === 'immersive-ar' ? 'AR' : 'VR'}`;

  const items = menuItems(state, { passthroughAvailable, views, phone, checking: !support.checked && !phone });
  const tools = toolsPanel(state);
  const onSelect = (id) => {
    const slide = parseSlide(id);
    if (slide) slideTo(slide.id, slide.value);
    else if (parseSlideEnd(id) === 'xrResolution') setRestartWanted(true); // (let go: the new resolution takes a new session)
    else if (id.startsWith(PICK_PREFIX)) {
      // a choice from an open dropdown's list, which then closes
      const choice = pickedChoice(items, id) ?? pickedChoice(tools.items, id);
      if (!choice) return;
      actions.closeDropdown(choice.id);
      choose(choice.id, choice.value);
    } else if (id === MENU_TOGGLE) actions.toggleMenu();
    else if (id === TOOLS_TOGGLE) actions.toggleTools();
    else if (id === VIEW_TOGGLE) {
      if (inXR) exitXR();
      else selectView('hmd');
    }
    else if (items.find((item) => item.id === id)?.group) actions.toggleGroup(id);
    else if (settingItems([...items, ...tools.items]).find((item) => item.id === id)?.dropdown) actions.toggleDropdown(id);
    else if (id === 'gravity') actions.toggleGravity();
    else if (id === 'simulation') actions.togglePause();
    else if (id === 'reset') actions.resetBodies();
    else if (id === 'new') actions.setBodies([]);
    else if (id === 'save')
      saveScene({ bodies: state.bodies, registry, gravity: state.gravity }).catch((e) => {
        console.error('[physics-sandbox] could not save the scene', e);
        setError(`Couldn't save the scene: ${describe(e)}`);
      });
    else if (id === 'open')
      openScene().then(
        (scene) => {
          if (!scene) return;
          setError(null);
          actions.setBodies(scene.bodies);
          if (scene.gravity !== undefined) actions.setGravity(scene.gravity);
        },
        (e) => {
          console.error('[physics-sandbox] could not open the scene', e);
          setError(`Couldn't open the scene: ${describe(e)}`);
        },
      );
    else if (id === 'controllerGuide') actions.toggleControllerGuide();
    else if (id === 'vsync') actions.toggleVSync();
    else if (id === 'reflections') actions.toggleReflections();
    else if (['grid', 'refraction', 'shadows', 'glowLights', 'surfaceDetail', 'liquidSurfaces', 'particles'].includes(id)) actions.toggleEffect(id);
    else if (id === SCALE_RESET) actions.resetScale();
  };
  const slideTo = (id, value) => {
    if (id === 'textSize') actions.setTextSize(value);
    else if (id === 'volume') actions.setVolume(value);
    else if (id === 'vibration') actions.setVibration(value);
    else if (id === 'xrResolution') actions.setXRResolution(value);
  };
  const choose = (id, value) => {
    if (id === 'tool') actions.setTool(value);
    else if (id === 'material') actions.setMaterial(value);
    else if (id === 'background') actions.setBackground(value);
    else if (id === 'view') selectView(value);
  };
  const selectView = (next) => {
    if (next === view) return;
    const toXR = XR_VIEWS.includes(next);
    if (toXR) actions.setPhoneStereo(next === 'phoneViewer');
    if (toXR && !inXR) {
      // if the session fails to start, the panel shows Normal
      actions.setScreenView('normal');
      enterXR(next === 'phoneViewer');
    } else if (!toXR) {
      if (inXR) exitXR();
      actions.setScreenView(next);
    }
  };
  const labels = useMemo(() => possibleLabels({ passthroughAvailable, views }), [passthroughAvailable, views]);
  // the panels' template, shared by the windowed and XR renderers; the View
  // panel only where a headset can be used
  const panels = { options: optionsPanel({ open: state.menuOpen, status, items, labels, scale: state.sceneScale }), view: views.includes('hmd') ? viewPanel(inXR) : null, tools };
  const leftPanels = [panels.options, ...(panels.view ? [panels.view] : [])];

  return (
    <>
      <Canvas flat shadows dpr={[1, 2]} camera={{ position: [0, 1.1, 1.9], fov: 60, near: 0.02, far: 1000 }}>
        <XR store={store}>
          <Suspense fallback={null}>
            <Scene
              state={state}
              panels={panels}
              onSelect={onSelect}
              menuOverlay={menuOverlay}
              phone={phone}
              bodies={state.bodies}
              setBodies={actions.setBodies}
              registry={registry}
              onScale={actions.setSceneScale}
              setClip={actions.setClip}
              resetScale={state.scaleReset}
            />
          </Suspense>
        </XR>
      </Canvas>
      {state.handheld ? (
        <>
          <CardboardOverlay split={state.stereo} onExit={exitXR} />
          {menuOverlay && <Hud panels={[panels.options]} onSelect={onSelect} error={error} />}
        </>
      ) : sessionActive ? (
        menuOverlay && (
          <XROverlay>
            <Hud panels={[panels.options]} right={[tools]} onSelect={onSelect} error={error} />
          </XROverlay>
        )
      ) : (
        <Hud panels={leftPanels} right={[tools]} onSelect={onSelect} error={error} sbs={state.view === 'sbs'} resizable />
      )}
    </>
  );
}
