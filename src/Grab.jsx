import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { pulse, readControllers } from './grip.js';
import { focusables, slideEndId, slideId } from './menu.js';
import { distanceOutside as shapeDistance, restingPosition } from './shapes.js';
import { transformMatrix } from './Physics.jsx';

// Touch controller grips: the objects, and the XR panels, as in grid-game-threejs.
//
// Each controller has a probe, as in xr-music-threejs: a 2 cm orange ball 5 cm
// in front of it (see controllerTip). A grip pressed while the probe touches
// an object picks it up; otherwise, a grip pressed while the controller points
// at a panel takes the panel, and pointed at an object, picks that up from
// afar. A held object stays fixed in the hand, and let go it flies on at the
// hand's speed and spin (see Holds in Physics.jsx). The probe buzzes softly
// while it's inside an object, so you can feel what you could take (not while
// its grip is held, nor on something held); a held object striking or sliding
// on another buzzes the hand holding it (see ContactSounds).
//
// The other grip pressed with its probe on the object already held (or its
// ray pointing at it): both hands hold it, to turn and resize it. It follows the hands' midpoint, turns
// with the line between the probes (and with the hands' twist about it), and
// grows or shrinks with the distance between them; with a trigger held, only
// along that line (the line when the trigger was pressed), stretching it.
// Let go of either grip and its new size is its own (its collider too).
//
// The sticks: the left moves the player, the way the left controller points
// (level with the floor), the right turns them about their head. Pressed in
// (L3 / R3), a stick switches to the panels docked on its controller (its
// probe turns blue): up and down go through their buttons, settings and
// choices (left and right set a slider), A / X presses the one lit, B / Y
// goes up a level (closes the dropdown or group it's in). Pressed again,
// back to moving.
//
// With a shape tool (or Paste) in hand, each controller shows a wireframe of
// what it would make: on the surface its ray points at (turned the way it
// points), or, pointing at nothing, round its probe (turned as the hand is).
// Its trigger makes it there.
//
// The panels dock on a controller, stacked upward, tipped toward the eyes:
// the View panel and Options above it on the left, the Tools panel on the
// right. A grip pressed while that controller points at a panel, or touches it,
// takes the panel off its dock and holds it rigidly; let go near the other
// controller it docks there, anywhere else it stays put (travelling with the
// player). A double tap of a grip docks the panel it points at on that
// controller, or, at no panel, lets go of the panels docked there, leaving
// them where they are. A triple tap brings every undocked panel to that controller.
//
// While a grip holds something, its thumbstick pushes it away along the ray
// (up) or reels it in (down), and rolls it about the ray (left / right),
// instead of moving or turning the player.
//
// Both grips held in mid-air (neither probe on an object, neither holding a
// panel), as in Tilt Brush: the scene scales with the distance between the
// hands and turns with the line between them, about their midpoint, which
// stays put. It's the player that changes size (the XR origin scales), so the
// physics is untouched; the probes, reaches and labels go with them.
//
// Without controllers (gaze, phones) the menu stands at `home` instead and
// the View and Tools panels hide.

const HANDS = ['left', 'right'];
const otherHand = (hand) => (hand === 'left' ? 'right' : 'left');

export const PROBE_RADIUS = 0.01; // m: the probe's, 2 cm across
const PROBE_TIP = new THREE.Vector3(0, 0, -0.05); // its centre, in target-ray space: 5 cm out in front
const PROBE_REACH = 0.01; // m: a probe this near an object (beyond touching it) can take it
const RAY_REACH = 10; // m: a grip takes an object pointed at this far away at most
export const PROBE_COLOR = '#d9642b'; // xr-music-threejs's picks' orange

const BUZZ_STRENGTH = 0.08;
const BUZZ_MS = 60;
const BUZZ_EVERY = 0.05; // seconds between pulses, so they overlap into a steady hum
const PULSE = { grab: [0.6, 50], detach: [0.4, 30], dock: [0.9, 80], zone: [0.25, 20], touch: [0.2, 20] }; // [strength, ms]

/** Docked on one controller, the panels stand stacked upward in this order (the first nearest it). */
const DOCK_STACK = ['view', 'tools', 'menu'];
/** Where each panel docks at first. */
const FIRST_DOCK = { menu: 'left', view: 'left', tools: 'right' };
// in the controller's pointing frame (-Z forward, +Y up): the stack stands on
// its hand's anchor, the first panel's button over the controller, its faces
// tipped up toward the eyes. On the left hand: 1 cm left, 6 cm up, 2 cm back,
// tilted 45° (the top leaning forward) and rolled 5°; the right hand mirrors it
// (as tuned in grid-game-threejs: Debug → Docking)
const dockPose = (mirror) => ({
  anchor: new THREE.Vector3(-0.01 * mirror, 0.06, 0.02),
  turn: new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-45), 0, THREE.MathUtils.degToRad(5 * mirror), 'YXZ')),
});
const DOCK_POSE = { left: dockPose(1), right: dockPose(-1) };
const DOCK_GAP = 0.008; // m between docked panels
const DOCK_SCALE = 0.5; // docked, the panels are half their free size
const DOCK_REACH = 0.12; // m: a held panel let go this near the other controller docks there
const TOUCH_REACH = 0.03; // m: a grip this near a panel's face takes it
const GRIP_TAP_S = 0.3; // a grip pressed no longer than this is a tap...
const GRIP_DOUBLE_TAP_S = 0.35; // ...and pressed again within this, a double tap (once more: a triple tap)
const FLY_S = 0.4; // a panel docked from afar flies there
const GROW_RATE = 12; // per second: a panel in the hand eases to its free size
// a thumbstick while its grip holds something
const PUSH_RATE = 1.5; // per second at full tilt, this share of its distance from the hand...
const PUSH_MIN_M = 0.25; // ...but never slower than at this distance
const REEL_MIN_M = 0.05; // reeled in no nearer the hand than this
const ROLL_RATE = Math.PI; // radians per second at full tilt
// scaling the scene
export const SCENE_SCALE = { min: 0.05, max: 20 }; // how small and big the scene gets
// the sticks
const MOVE_SPEED = 1.5; // m/s at full tilt (at the player's size)
const TURN_SPEED = 1.5; // rad/s at full tilt
const MENU_TILT = 0.6; // a stick tilted this far steps through a panel...
const MENU_REPEAT = [0.4, 0.12]; // ...again after this long held, then this often
export const PROBE_MENU_COLOR = '#3a8dde'; // a probe whose stick works the panels
const SCALE_JOIN_S = 0.3; // the second grip this soon after the first, which took an object it pointed at, still scales (and drops it)
// resizing an object with both hands
const RESIZE = { min: 0.2, max: 10 }; // how much smaller or bigger than made (on average) an object gets
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _r3 = new THREE.Matrix3();
const _one = new THREE.Vector3(1, 1, 1);

/** How far `dq` turns about unit `axis` (its twist about it), in radians, -π to π. */
function twistAbout(dq, axis) {
  const proj = dq.x * axis.x + dq.y * axis.y + dq.z * axis.z;
  let angle = 2 * Math.atan2(proj, dq.w);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

const _world = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _step = new THREE.Matrix4();
const _originInverse = new THREE.Matrix4();
const _gripInverse = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** A controller's probe's centre, into `out`, from its target-ray pose (world): PROBE_TIP in front of it. */
export const controllerTip = (rayMatrix, out) => out.copy(PROBE_TIP).applyMatrix4(rayMatrix);

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** A panel group's visible panel, in its own metres at scale 1: { left, right, top, bottom, button } (set by the panel as userData.bounds). */
const boundsOf = (group) => group.userData.bounds ?? { left: -0.05, right: 0.05, top: 0.05, bottom: -0.05, button: 0 };

/** `m`'s rotation about the line through `origin` along unit `axis`, by `angle`. */
function rotationAbout(origin, axis, angle) {
  return new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(_step.makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
}

/** How far world point `p` is outside object `entry`'s solid (0 or less: inside it). */
function distanceOutside(entry, p) {
  return shapeDistance(entry.def.shape, entry.mesh.current.worldToLocal(_v.copy(p)));
}

/**
 * Grip controls for the objects and the panels. `origin` (the XROrigin the
 * controllers are tracked relative to, and the panels' parent) is a ref;
 * `panels`: { menu, view, tools }, refs to the panels' groups; `registry` and
 * `holds`: the objects and who holds them (see Physics.jsx); `probes`: { left,
 * right }, refs to the probes' meshes, placed here; `home`: the menu's {
 * position, rotation } without controllers, `homeScale` its scale there;
 * `textSize`: Accessibility → Text Size (the panels that much bigger);
 * `onScale(scale)`: the scene scale changed (both grips in mid-air);
 * `onResize(id, transform)`: an object was resized with both hands (its new 3×3, see Physics.jsx makeBody);
 * `placing`: a ref to what a shape tool or Paste would make (Scene.jsx
 * placingSpec, or null), `onPlace(spec, position, quaternion)` makes it,
 * `surfaces()` the meshes it can rest on, `previews` { left, right } refs to
 * the controllers' wireframes of it; `menus`: a ref to the panels' templates
 * ({ menu, view, tools }, see menu.js), `onSelect(id)` their buttons, and
 * `onFocus({ menu, view, tools })` hears what the sticks have focused in each.
 * Returns a ref to which hands' grips hold something now ({ left, right }),
 * whose sticks are then theirs, not the player's.
 */
export function useControllerGrips({
  panels,
  origin,
  registry,
  holds,
  probes,
  textSize,
  home,
  homeScale,
  onScale,
  onResize,
  placing,
  onPlace,
  surfaces,
  previews,
  menus,
  onSelect,
  onFocus,
}) {
  const gl = useThree((s) => s.gl);
  // hand -> { target: 'body', id, offset, point, byRay, at } | { target: 'panel', key, offset, point, size, grow, zone } | { target: 'scale' } | { target: 'resize', id } | { target: 'none' }
  const grabs = useRef({});
  const scaling = useRef(null); // both grips in mid-air: { k0, turn0, mid0 (world), span0, angle0 (tracking space) }
  const reported = useRef(1);
  // both hands on one object: { id, owner (the hand Holds has it by), lock (a trigger held), base, now }, each pose
  // { position, quaternion (the body's), transform (Matrix3: its resizing), tips: { left, right } (probes, world), grips: { left, right } (quaternions) }
  const resizing = useRef(null);
  const triggered = useRef({}); // hand -> its trigger was held last frame
  const buttons = useRef({}); // hand -> { stickPress, primary, secondary } last frame
  const menuMode = useRef({}); // hand -> its stick works the panels
  const focus = useRef({}); // hand -> { key, id }: what its stick has lit
  const steps = useRef({}); // `${hand}:${axis}` -> { dir, next }: a stick held over, stepping again
  const sliding = useRef({}); // hand -> the slider its stick moved (let go: its slideEnd)
  const reportedFocus = useRef('');
  const docks = useRef(Object.fromEntries(Object.entries(FIRST_DOCK).map(([key, hand]) => [key, { dock: hand }]))); // key -> { dock: hand | null, on, fly }
  const taps = useRef({}); // hand -> { pressedAt, tappedAt, count }
  const pressed = useRef({});
  const touching = useRef({}); // hand -> the object its probe touched last frame
  const nextBuzz = useRef({});
  const holding = useRef({});
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const homePose = useMemo(
    () => ({ position: new THREE.Vector3(...home.position), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...home.rotation)) }),
    [home],
  );

  useFrame((_, delta, frame) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now() / 1000;
    const referenceSpace = gl.xr.getReferenceSpace();
    const o = origin.current;
    let controllers = frame && o && referenceSpace ? readControllers(frame, referenceSpace, o) : {};
    const k = o?.scale.x ?? 1; // the player's size: reaches in the world go with it
    const buzz = (hand, [strength, ms]) => pulse(controllers[hand]?.gamepad, strength, ms);
    const groupOf = (key) => panels[key]?.current ?? null;
    const shownPanels = () => Object.keys(docks.current).filter((key) => groupOf(key) && isShown(groupOf(key)));
    const bodies = () => [...registry.values()].filter((e) => e.mesh.current);
    if (o) _originInverse.copy(o.matrixWorld).invert();

    // both grips in mid-air: the scene scales and turns about the hands' midpoint (the player does, inversely)
    const sc = scaling.current;
    if (sc && controllers.left && controllers.right) {
      const l = controllers.left.position.clone().applyMatrix4(_originInverse);
      const r = controllers.right.position.clone().applyMatrix4(_originInverse);
      const span = r.clone().sub(l);
      if (span.length() > 0.02) {
        const size = THREE.MathUtils.clamp((sc.k0 * sc.span0) / span.length(), 1 / SCENE_SCALE.max, 1 / SCENE_SCALE.min);
        const turn = sc.turn0 + sc.angle0 - Math.atan2(span.x, span.z);
        const mid = l.add(r).multiplyScalar(0.5 * size).applyAxisAngle(_up, turn);
        o.scale.setScalar(size);
        o.rotation.y = turn;
        o.position.copy(sc.mid0).sub(mid);
        o.updateMatrixWorld(true);
        _originInverse.copy(o.matrixWorld).invert();
        controllers = readControllers(frame, referenceSpace, o);
        if (Math.abs(1 / size - reported.current) > reported.current * 0.005) {
          reported.current = 1 / size;
          onScale?.(1 / size);
        }
      }
    }

    /** Puts panel `key`'s group at world matrix `world` (its parent is the origin). */
    const placeWorld = (key, world) => {
      _local.multiplyMatrices(_originInverse, world).decompose(groupOf(key).position, groupOf(key).quaternion, groupOf(key).scale);
    };

    /** The object controller `c`'s probe touches (the deepest in), or null. */
    const bodyTouched = (c) => {
      controllerTip(c.rayMatrix, _tip);
      let best = null;
      for (const entry of bodies()) {
        // (measured in the shape's own space: a resized one's distances scale back)
        const d = distanceOutside(entry, _tip) * (entry.measure.size / entry.shape.size) - PROBE_RADIUS * k;
        if (d <= PROBE_REACH * k && (!best || d < best.d)) best = { id: entry.def.id, d };
      }
      return best?.id ?? null;
    };

    /** The object controller `c` points at (the nearest), or null. */
    const bodyPointed = (c) => {
      raycaster.ray.copy(c.ray);
      raycaster.far = RAY_REACH * k;
      const [hit] = raycaster.intersectObjects(bodies().map((e) => e.mesh.current), false);
      return hit?.object.userData.bodyId ?? null;
    };

    /** The panel `c` points at or touches (nearest): { key, point (world), distance } or null. */
    const panelAt = (c) => {
      let best = null;
      raycaster.ray.copy(c.ray);
      raycaster.far = Infinity;
      for (const key of shownPanels()) {
        const g = groupOf(key);
        const hit = raycaster.intersectObject(g, true)[0];
        if (hit && (!best || hit.distance < best.distance)) best = { key, point: hit.point.clone(), distance: hit.distance };
      }
      if (best) return best;
      for (const key of shownPanels()) {
        const g = groupOf(key);
        const b = boundsOf(g);
        g.updateWorldMatrix(true, false);
        const local = g.worldToLocal(_v.copy(c.position));
        const reach = TOUCH_REACH / g.scale.x;
        if (local.x >= b.left - reach && local.x <= b.right + reach && local.y >= b.bottom - reach && local.y <= b.top + reach && Math.abs(local.z) < reach)
          return { key, point: c.position.clone(), distance: 0 };
      }
      return null;
    };

    /** Where held panel `key` would dock if let go now: the other controller when it's within DOCK_REACH, else null. */
    const dockZone = (hand, key) => {
      const c = controllers[otherHand(hand)];
      if (!c) return null;
      const g = groupOf(key);
      const b = boundsOf(g);
      g.updateWorldMatrix(true, false);
      const local = g.worldToLocal(_v.copy(c.position));
      local.set(THREE.MathUtils.clamp(local.x, b.left, b.right), THREE.MathUtils.clamp(local.y, b.bottom, b.top), 0);
      return g.localToWorld(local).distanceTo(c.position) < DOCK_REACH * k ? otherHand(hand) : null;
    };

    const release = (key) => {
      for (const hand of HANDS) if (grabs.current[hand]?.key === key) grabs.current[hand] = { target: 'none' };
    };

    /** Panel `key` docks on `hand`, flying there from where it is. */
    const dock = (key, hand) => {
      release(key);
      const g = groupOf(key);
      docks.current[key].dock = hand;
      docks.current[key].fly = { t0: now, position: g.position.clone(), quaternion: g.quaternion.clone(), scale: g.scale.x };
    };

    const takePanel = (hand, c, at) => {
      const d = docks.current[at.key];
      buzz(hand, d.dock ? PULSE.detach : PULSE.grab);
      release(at.key); // (the other hand lets go)
      Object.assign(d, { dock: null, on: null, fly: null });
      const g = groupOf(at.key);
      g.updateWorldMatrix(true, false);
      _gripInverse.copy(c.grip).invert();
      grabs.current[hand] = {
        target: 'panel',
        key: at.key,
        offset: _gripInverse.clone().multiply(g.matrixWorld),
        point: at.point.clone().applyMatrix4(_gripInverse),
        size: 1,
        grow: textSize / g.scale.x, // (to its free size)
        zone: null,
      };
    };

    /** `hand` picks up object `id`, from the other hand or a pointer if they had it (`byRay`: pointed at from afar). */
    const takeBody = (hand, c, id, byRay = false) => {
      const entry = registry.get(id);
      const other = otherHand(hand);
      if (grabs.current[other]?.id === id) grabs.current[other] = { target: 'none' };
      if (!entry?.mesh.current || !holds.take(id, hand)) return;
      buzz(hand, PULSE.grab);
      grabs.current[hand] = bodyGrab(c, id);
      grabs.current[hand].byRay = byRay;
    };

    /** A grip's hold on object `id` as it is now: its pose (the body's, not the mesh's resizing) in the grip's space. */
    const bodyGrab = (c, id) => {
      const h = holds.map.get(id);
      _world.compose(h.position, h.quaternion, _one);
      _gripInverse.copy(c.grip).invert();
      return {
        target: 'body',
        id,
        offset: _gripInverse.clone().multiply(_world),
        point: h.position.clone().applyMatrix4(_gripInverse),
        byRay: false,
        at: now,
      };
    };

    /** Object `id`'s pose for resizing, as it is now. */
    const resizePose = (id, transform) => {
      const h = holds.map.get(id);
      const pose = { position: h.position.clone(), quaternion: h.quaternion.clone(), transform: transform.clone(), tips: {}, grips: {} };
      for (const hand of HANDS) {
        pose.tips[hand] = controllerTip(controllers[hand].rayMatrix, new THREE.Vector3());
        controllers[hand].grip.decompose(_pos, (pose.grips[hand] = new THREE.Quaternion()), _scale);
      }
      return pose;
    };

    /** The other hand, holding object `id`, is joined by this one: both turn and resize it. */
    const startResize = (id) => {
      const entry = registry.get(id);
      const h = holds.map.get(id);
      if (!entry || !h) return;
      h.hands = [...HANDS];
      const transform = new THREE.Matrix3();
      if (entry.def.transform) transform.fromArray(entry.def.transform);
      const base = resizePose(id, transform);
      resizing.current = { id, owner: h.by, lock: false, base, now: base };
      holds.resizing = true; // (the triggers lock the resizing now, rather than working the tools)
      for (const hand of HANDS) {
        grabs.current[hand] = { target: 'resize', id };
        buzz(hand, PULSE.grab);
      }
    };

    /** `hand` lets go while both held object `id`: its new size is kept, and the other hand holds it on. */
    const endResize = (hand) => {
      const r = resizing.current;
      resizing.current = null;
      holds.resizing = false;
      const other = otherHand(hand);
      const h = holds.map.get(r.id);
      if (h) delete h.hands;
      const t = r.now.transform.elements;
      const identity = t.every((x, i) => Math.abs(x - (i % 4 === 0 ? 1 : 0)) < 1e-4);
      onResize?.(r.id, identity ? undefined : [...t]);
      grabs.current[other] = { target: 'none' };
      const c = controllers[other];
      if (!c || !pressed.current[other] || !h) {
        holds.release(r.id, r.owner);
        return;
      }
      if (r.owner !== other) holds.take(r.id, other);
      grabs.current[other] = bodyGrab(c, r.id);
    };

    /** Both grips in mid-air: scaling starts from here. */
    const startScale = () => {
      const l = controllers.left.position.clone().applyMatrix4(_originInverse);
      const r = controllers.right.position.clone().applyMatrix4(_originInverse);
      const span = r.clone().sub(l);
      scaling.current = {
        k0: o.scale.x,
        turn0: o.rotation.y,
        mid0: controllers.left.position.clone().add(controllers.right.position).multiplyScalar(0.5),
        span0: Math.max(span.length(), 0.02),
        angle0: Math.atan2(span.x, span.z),
      };
      for (const h of HANDS) {
        grabs.current[h] = { target: 'scale' };
        buzz(h, PULSE.grab);
      }
    };

    const gripStart = (hand, c) => {
      const tap = (taps.current[hand] ??= { pressedAt: -1, tappedAt: -Infinity, count: 0 });
      tap.count = now - tap.tappedAt < GRIP_DOUBLE_TAP_S ? tap.count + 1 : 1; // (this press: the count-th tap in a row)
      tap.tappedAt = -Infinity;
      tap.pressedAt = now;
      grabs.current[hand] = { target: 'none' };
      // the probe on an object: that, before anything
      const touched = bodyTouched(c);
      const other0 = grabs.current[otherHand(hand)];
      if (touched != null && other0?.target === 'body' && other0.id === touched && holds.isHeld(touched, otherHand(hand)) && controllers[otherHand(hand)]) {
        // the other hand holds it: both turn and resize it
        startResize(touched);
        return;
      }
      if (touched != null) {
        takeBody(hand, c, touched);
        return;
      }
      // pointing at what the other hand holds: both turn and resize it
      if (other0?.target === 'body' && holds.isHeld(other0.id, otherHand(hand)) && controllers[otherHand(hand)] && bodyPointed(c) === other0.id) {
        startResize(other0.id);
        return;
      }
      // the other grip already held in mid-air (or just took something it pointed at): both scale the scene
      const other = grabs.current[otherHand(hand)];
      if (o && pressed.current[otherHand(hand)] && controllers[otherHand(hand)] && (other?.target === 'none' || (other?.target === 'body' && other.byRay && now - other.at < SCALE_JOIN_S))) {
        if (other.target === 'body') holds.release(other.id, otherHand(hand), true);
        startScale();
        return;
      }
      if (tap.count >= 3) {
        // every panel not docked flies to this controller
        const free = shownPanels().filter((key) => !docks.current[key].dock);
        for (const key of free) dock(key, hand);
        if (free.length) buzz(hand, PULSE.dock);
        return;
      }
      const at = panelAt(c);
      if (tap.count === 2) {
        if (at) {
          // the panel pointed at docks here
          dock(at.key, hand);
          buzz(hand, PULSE.dock);
          return;
        }
        // no panel: the ones docked here stay where they are, free
        const mine = shownPanels().filter((key) => docks.current[key].on === hand);
        for (const key of mine) Object.assign(docks.current[key], { dock: null, on: null, fly: null });
        if (mine.length) buzz(hand, PULSE.detach);
        return;
      }
      // a panel or an object pointed at: the nearer
      const pointed = bodyPointed(c);
      if (at && (pointed == null || at.distance <= raycaster.ray.origin.distanceTo(registry.get(pointed).mesh.current.getWorldPosition(_v))))
        takePanel(hand, c, at);
      else if (pointed != null) takeBody(hand, c, pointed, true);
    };

    const gripEnd = (hand) => {
      const tap = taps.current[hand];
      if (tap) tap.tappedAt = tap.count < 3 && now - tap.pressedAt <= GRIP_TAP_S ? now : -Infinity; // (a short press: a tap, unless it ended a triple)
      const g = grabs.current[hand];
      delete grabs.current[hand];
      if (g?.target === 'resize') {
        if (resizing.current) endResize(hand);
        return;
      }
      if (g?.target === 'scale') {
        // one grip let go: scaling's done, the other grip holds nothing now
        scaling.current = null;
        grabs.current[otherHand(hand)] = { target: 'none' };
        return;
      }
      if (g?.target === 'body') {
        holds.release(g.id, hand);
        return;
      }
      if (g?.target !== 'panel') return;
      // let go near the other controller: it docks there
      const zone = dockZone(hand, g.key);
      if (!zone) return;
      docks.current[g.key].dock = zone;
      buzz(zone, PULSE.dock);
    };

    // grips pressed and let go
    for (const hand of HANDS) {
      const down = Boolean(controllers[hand]?.squeeze);
      if (down && !pressed.current[hand]) gripStart(hand, controllers[hand]);
      else if (!down && pressed.current[hand]) gripEnd(hand);
      pressed.current[hand] = down;
    }

    // both hands on one object: turned with them, resized by their distance (along their line, a trigger held)
    const rz = resizing.current;
    if (rz && controllers.left && controllers.right && holds.isHeld(rz.id)) {
      const lock = controllers.left.trigger || controllers.right.trigger;
      if (lock !== rz.lock) {
        // a trigger pressed or let go: carry on from here
        rz.base = resizePose(rz.id, rz.now.transform);
        rz.lock = lock;
        buzz('left', PULSE.zone);
        buzz('right', PULSE.zone);
      }
      const base = rz.base;
      const tipL = controllerTip(controllers.left.rayMatrix, new THREE.Vector3());
      const tipR = controllerTip(controllers.right.rayMatrix, new THREE.Vector3());
      const span0 = base.tips.right.clone().sub(base.tips.left);
      const span = tipR.clone().sub(tipL);
      const len0 = Math.max(span0.length(), 0.01);
      const axis = span0.clone().divideScalar(len0);
      // the swing of the line between the probes, and the hands' twist about it
      const swing = new THREE.Quaternion().setFromUnitVectors(axis, span.clone().normalize());
      let twist = 0;
      for (const hand of HANDS) {
        controllers[hand].grip.decompose(_pos, _q1, _scale);
        twist += twistAbout(_q0.copy(_q1).multiply(base.grips[hand].clone().invert()), axis) / 2;
      }
      const turn = swing.multiply(new THREE.Quaternion().setFromAxisAngle(axis, twist));
      // how much bigger: kept within RESIZE of as made
      let f = Math.max(span.length(), 0.01) / len0;
      const det0 = Math.abs(base.transform.determinant());
      const det = (x) => det0 * (rz.lock ? x : x * x * x);
      if (det(f) > RESIZE.max ** 3) f = rz.lock ? RESIZE.max ** 3 / det0 : Math.cbrt(RESIZE.max ** 3 / det0);
      if (det(f) < RESIZE.min ** 3) f = rz.lock ? RESIZE.min ** 3 / det0 : Math.cbrt(RESIZE.min ** 3 / det0);
      // the stretch, in the world as it was: all ways, or along the line only
      const stretch = new THREE.Matrix3().multiplyScalar(0);
      if (rz.lock) {
        const a = axis;
        const g = f - 1;
        stretch.set(1 + g * a.x * a.x, g * a.x * a.y, g * a.x * a.z, g * a.y * a.x, 1 + g * a.y * a.y, g * a.y * a.z, g * a.z * a.x, g * a.z * a.y, 1 + g * a.z * a.z);
      } else stretch.set(f, 0, 0, 0, f, 0, 0, 0, f);
      const mid0 = base.tips.left.clone().add(base.tips.right).multiplyScalar(0.5);
      const mid = tipL.clone().add(tipR).multiplyScalar(0.5);
      const position = base.position.clone().sub(mid0).applyMatrix3(stretch).applyQuaternion(turn).add(mid);
      const quaternion = turn.clone().multiply(base.quaternion);
      // the body turns rigidly; the stretch, carried into its own space, is its resizing: R0⁻¹ S R0 T0
      _r3.setFromMatrix4(_world.makeRotationFromQuaternion(base.quaternion));
      _m3.copy(_r3).transpose().multiply(stretch).multiply(_r3).multiply(base.transform);
      rz.now = { ...rz.now, position, quaternion, transform: _m3.clone() };
      holds.move(rz.id, rz.owner, position, quaternion);
      const entry = registry.get(rz.id);
      if (entry) entry.preview = (entry.preview ?? new THREE.Matrix4()).setFromMatrix3(_m3);
    }

    // what each grip holds, and its stick on it
    for (const hand of HANDS) {
      const c = controllers[hand];
      const g = grabs.current[hand];
      // (an object another hand or a pointer took away isn't this hand's any more)
      if (g?.target === 'body' && !holds.isHeld(g.id, hand)) grabs.current[hand] = { target: 'none' };
      holding.current[hand] = Boolean(c && g && g.target !== 'none');
      if (!c || !g || g.target === 'none' || g.target === 'scale' || g.target === 'resize') continue;
      if (g.target === 'panel' && !groupOf(g.key)) continue;
      const { x, y } = c.stick;
      // what's held: its pose in the hand, and the point it's held by, both shift in the grip's space
      _gripInverse.copy(c.grip).invert();
      _axis.copy(c.ray.direction).transformDirection(_gripInverse);
      if (y) {
        const dist = g.point.length();
        const u = _axis.clone().multiplyScalar(Math.max(-y * PUSH_RATE * Math.max(dist, PUSH_MIN_M) * dt, REEL_MIN_M - dist));
        g.offset.premultiply(_step.makeTranslation(u.x, u.y, u.z));
        g.point.add(u);
      }
      if (x) {
        const roll = rotationAbout(c.ray.origin.clone().applyMatrix4(_gripInverse), _axis, x * ROLL_RATE * dt);
        g.offset.premultiply(roll);
        g.point.applyMatrix4(roll);
      }
      if (g.target === 'body') {
        _world.multiplyMatrices(c.grip, g.offset).decompose(_pos, _quat, _scale);
        holds.move(g.id, hand, _pos, _quat);
        continue;
      }
      // a panel, easing to its free size about the point it's held by
      g.size += (g.grow - g.size) * (1 - Math.exp(-GROW_RATE * dt));
      const { x: px, y: py, z: pz } = g.point;
      _local.makeTranslation(px, py, pz).multiply(_step.makeScale(g.size, g.size, g.size));
      _local.multiply(_step.makeTranslation(-px, -py, -pz)).multiply(g.offset);
      placeWorld(g.key, _world.multiplyMatrices(c.grip, _local));
      // a tick as it comes within reach of the other controller's dock
      const zone = dockZone(hand, g.key);
      if (zone && zone !== g.zone) buzz(zone, PULSE.zone);
      g.zone = zone;
    }

    // a shape tool or Paste: each controller's wireframe of what it would make, and its trigger making it
    const spec = placing?.current;
    // (none while anything's held, resized or scaled)
    const busy = HANDS.some((h) => grabs.current[h] && grabs.current[h].target !== 'none') || Boolean(resizing.current || scaling.current);
    for (const hand of HANDS) {
      const c = controllers[hand];
      const was = triggered.current[hand];
      triggered.current[hand] = Boolean(c?.trigger);
      const preview = previews?.[hand]?.current;
      if (!preview) continue;
      preview.visible = false;
      if (!spec || !c || busy) continue;
      raycaster.ray.copy(c.ray);
      raycaster.far = Infinity;
      const hit = raycaster.intersectObjects(surfaces(), false)[0];
      const panel = panelAt(c);
      if (panel && (!hit || panel.distance <= hit.distance)) continue; // (the panel's, then)
      let position;
      const quaternion = new THREE.Quaternion();
      if (hit) {
        // on what it points at, turned the way it points
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : _up.clone();
        position = restingPosition(spec.shape, spec.transform, hit.point, normal);
        quaternion.setFromAxisAngle(_up, Math.atan2(-c.ray.direction.x, -c.ray.direction.z));
      } else {
        // round the probe, turned as the hand is
        position = controllerTip(c.rayMatrix, new THREE.Vector3());
        c.grip.decompose(_pos, quaternion, _scale);
      }
      preview.matrix.compose(position, quaternion, _one).multiply(transformMatrix(spec.transform));
      preview.visible = true;
      if (c.trigger && !was) {
        onPlace(spec, position, quaternion);
        buzz(hand, PULSE.grab);
      }
    }

    // the sticks: moving and turning, or (pressed in) working the panels
    const pressedNow = (hand, button) => {
      const c = controllers[hand];
      const was = buttons.current[hand]?.[button];
      return Boolean(c?.[button] && !was);
    };
    /** A stick held over along `axis` (-1, 0, 1): 1 or -1 when it steps (at once, then again while held), else 0. */
    const step = (hand, axis, value) => {
      const key = `${hand}:${axis}`;
      const dir = value > MENU_TILT ? 1 : value < -MENU_TILT ? -1 : 0;
      const s = (steps.current[key] ??= { dir: 0, next: 0 });
      if (dir !== s.dir) {
        s.dir = dir;
        s.next = now + MENU_REPEAT[0];
        return dir;
      }
      if (dir && now >= s.next) {
        s.next = now + MENU_REPEAT[1];
        return dir;
      }
      return 0;
    };
    for (const hand of HANDS) {
      const c = controllers[hand];
      if (pressedNow(hand, 'stickPress')) {
        menuMode.current[hand] = !menuMode.current[hand];
        buzz(hand, menuMode.current[hand] ? PULSE.dock : PULSE.detach);
      }
      const probe = probes[hand]?.current;
      probe?.material.color.set(menuMode.current[hand] ? PROBE_MENU_COLOR : PROBE_COLOR);
      if (!c || !menuMode.current[hand] || holding.current[hand]) {
        if (!menuMode.current[hand]) focus.current[hand] = null;
        continue;
      }
      // the panels docked on this controller, top to bottom as they stand (or, none docked there, every one shown)
      const mine = DOCK_STACK.filter((key) => docks.current[key]?.on === hand && groupOf(key) && isShown(groupOf(key))).reverse();
      const keys = mine.length ? mine : shownPanels();
      const list = keys.flatMap((key) => (menus?.current[key] ? focusables(menus.current[key]).map((f) => ({ ...f, key })) : []));
      if (!list.length) continue;
      const f = focus.current[hand];
      let i = Math.max(0, list.findIndex((x) => x.key === f?.key && x.id === f?.id));
      const dy = step(hand, 'y', c.stick.y); // (down: on through the list)
      if (dy) {
        i = THREE.MathUtils.clamp(i + dy, 0, list.length - 1);
        buzz(hand, PULSE.zone);
      }
      const at = list[i];
      const dx = step(hand, 'x', c.stick.x);
      if (dx && at.slider) {
        const { min, max, step: by, value } = at.slider;
        const v = THREE.MathUtils.clamp(+(value + dx * by).toFixed(4), min, max);
        if (v !== value) {
          onSelect?.(slideId(at.id, v));
          sliding.current[hand] = at.id;
          buzz(hand, PULSE.zone);
        }
      }
      // (a slider let go: its change is done, as when a pointer lets go of it)
      if (!c.stick.x && sliding.current[hand]) {
        onSelect?.(slideEndId(sliding.current[hand]));
        sliding.current[hand] = null;
      }
      if (pressedNow(hand, 'primary') && !at.slider) {
        onSelect?.(at.id);
        buzz(hand, PULSE.grab);
      }
      let lit = at;
      if (pressedNow(hand, 'secondary') && at.parent) {
        // up a level: the group or dropdown it's in closes, and is lit
        onSelect?.(at.parent);
        lit = { key: at.key, id: at.parent };
        buzz(hand, PULSE.detach);
      }
      focus.current[hand] = { key: lit.key, id: lit.id };
    }
    for (const hand of HANDS) {
      const c = controllers[hand];
      buttons.current[hand] = { stickPress: c?.stickPress, primary: c?.primary, secondary: c?.secondary };
    }
    // what's lit in each panel, told when it changes
    const lit = {};
    for (const hand of HANDS) if (focus.current[hand]) lit[focus.current[hand].key] = focus.current[hand].id;
    const litKey = JSON.stringify(lit);
    if (litKey !== reportedFocus.current) {
      reportedFocus.current = litKey;
      onFocus?.(lit);
    }
    // moving, the way the left controller points (level), and turning about the head
    const lc = controllers.left;
    if (o && lc && !holding.current.left && !menuMode.current.left && (lc.stick.x || lc.stick.y)) {
      const forward = _v.copy(lc.ray.direction).setY(0);
      if (forward.lengthSq() > 1e-6) {
        forward.normalize();
        const right = _axis.crossVectors(forward, _up);
        o.position.addScaledVector(forward, -lc.stick.y * MOVE_SPEED * dt * k).addScaledVector(right, lc.stick.x * MOVE_SPEED * dt * k);
      }
    }
    const rc = controllers.right;
    if (o && rc && !holding.current.right && !menuMode.current.right && rc.stick.x) {
      // (pushed right: turned right) about the head, so the view turns where it is
      const turn = -rc.stick.x * TURN_SPEED * dt;
      gl.xr.getCamera().getWorldPosition(_pos);
      const dx = o.position.x - _pos.x;
      const dz = o.position.z - _pos.z;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      o.position.x = _pos.x + dx * cos + dz * sin;
      o.position.z = _pos.z - dx * sin + dz * cos;
      o.rotation.y += turn;
    }

    // the probes: at each controller's tip; a tap as one comes onto an object, a hum while it's in one
    for (const hand of HANDS) {
      const c = controllers[hand];
      const probe = probes[hand]?.current;
      if (probe) {
        probe.visible = Boolean(c);
        if (c) probe.position.copy(controllerTip(c.rayMatrix, _v).applyMatrix4(_originInverse));
      }
      // (not while its grip is held, whatever it holds)
      if (!c || pressed.current[hand]) {
        touching.current[hand] = null;
        continue;
      }
      let touched = bodyTouched(c);
      if (touched != null && holds.isHeld(touched)) touched = null; // (nor on something held)
      if (touched != null && touched !== touching.current[hand]) {
        buzz(hand, PULSE.touch);
        nextBuzz.current[hand] = now + BUZZ_EVERY;
      } else if (touched != null && now >= (nextBuzz.current[hand] ?? 0)) {
        pulse(c.gamepad, BUZZ_STRENGTH, BUZZ_MS);
        nextBuzz.current[hand] = now + BUZZ_EVERY;
      }
      touching.current[hand] = touched;
    }

    // the panels not held: docked ones stacked on their controller, or at home without controllers
    const gaze = !controllers.left && !controllers.right;
    const rows = { left: [], right: [] };
    for (const key of DOCK_STACK) {
      const g = groupOf(key);
      const d = docks.current[key];
      if (!g) continue;
      if (key !== 'menu') g.visible = !gaze; // (only where a controller can press them)
      if (HANDS.some((hand) => grabs.current[hand]?.key === key) || !d.dock) continue;
      if (gaze) {
        if (key === 'menu') {
          g.position.copy(homePose.position);
          g.quaternion.copy(homePose.quaternion);
          g.scale.setScalar(homeScale * textSize);
        }
        d.on = null;
        continue;
      }
      d.on = controllers[d.dock] ? d.dock : otherHand(d.dock);
      if (g.visible) rows[d.on].push(key);
    }
    for (const hand of HANDS) {
      const keys = rows[hand];
      if (!keys.length) continue;
      const sc = DOCK_SCALE * textSize;
      const first = boundsOf(groupOf(keys[0]));
      const x = -(first.button - first.left) * sc;
      let y = 0;
      keys.forEach((key, i) => {
        const g = groupOf(key);
        const b = boundsOf(g);
        // standing on its bottom edge, left edges in line, each a hair in front of the last
        const pose = DOCK_POSE[hand];
        _pos.set(x - b.left * sc, y - b.bottom * sc, i * 0.0005).applyQuaternion(pose.turn).add(pose.anchor);
        _world.compose(_pos, pose.turn, _scale.setScalar(sc)).premultiply(controllers[hand].rayMatrix);
        placeWorld(key, _world);
        const fly = docks.current[key].fly;
        if (fly) {
          // on its way from where it was
          const t = Math.min(1, (now - fly.t0) / FLY_S);
          const k = THREE.MathUtils.smootherstep(t, 0, 1);
          g.position.lerpVectors(fly.position, g.position, k);
          g.quaternion.slerpQuaternions(fly.quaternion, g.quaternion, k);
          g.scale.setScalar(THREE.MathUtils.lerp(fly.scale, g.scale.x, k));
          if (t >= 1) docks.current[key].fly = null;
        }
        y += (b.top - b.bottom) * sc + DOCK_GAP;
      });
    }
  });

  return holding;
}

/** Each controller's probe, a 2 cm orange ball; placed (in the XR origin, its parent) by useControllerGrips. */
export function Probes({ probes }) {
  return HANDS.map((hand) => (
    <mesh key={hand} ref={probes[hand]} visible={false} raycast={() => null}>
      <sphereGeometry args={[PROBE_RADIUS, 16, 12]} />
      <meshStandardMaterial color={PROBE_COLOR} roughness={0.3} />
    </mesh>
  ));
}
