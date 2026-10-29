import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IfInSessionMode, XROrigin, useXR } from '@react-three/xr';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CameraBackground, CardboardRig } from './Cardboard.jsx';
import { GazeReticle } from './Gaze.jsx';
import { ControllerGuide } from './ControllerGuide.jsx';
import { XRPanel } from './XRMenuPanel.jsx';
import { Probes, useControllerGrips } from './Grab.jsx';
import { SOLID_BACKGROUND } from './menu.js';
import { FramePacing } from './FramePacing.jsx';
import { Physics, useRapier } from '@react-three/rapier';
import { AirDrag, ContactSounds, Disc, GlowLights, Holds, MaterialLabels, Particles, SandboxBodies, makeBody, particles, setLookQuality, transformMatrix, withMade } from './Physics.jsx';
import { SHAPES, restingPosition, shapeOf, wireOf } from './shapes.js';
import { materialById, randomMaterial } from './materials.js';
import { Fluids } from './Fluids.jsx';
import { PhoneStereoCameraFeed, PhoneStereoXR } from './PhoneStereo.jsx';
import { SideBySide } from './SideBySide.jsx';
import { Interlaced } from './Interlaced.jsx';

const BASE = import.meta.env.BASE_URL;

const SKY_URL = `${BASE}img/skybox.jpg`;

/** Renders `fallback` if a child throws, e.g. a texture that failed to download. */
class AssetBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn('[physics-sandbox] asset failed to load, continuing without it:', error.message);
  }
  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}

// The windowed view looks at the disc from a little way off, a bit above;
// in XR you start just off its edge, facing its centre, real size: the disc's
// top is the floor you stand on
const LOOK_AT = [0, 0.15, 0];
const XR_START = [0, 0, 1.5];
// the window's camera, as App.jsx's Canvas starts it
const WINDOW_START = [0, 1.1, 1.9];
const WINDOW_FOV = 60;
const ENVIRONMENT_INTENSITY = 0.5; // the studio's light on the objects, besides the sun's (fuller, it washes them out)
const GRAVITY = [0, -9.81, 0];
const NO_GRAVITY = [0, 0, 0];
// Without controllers (gaze, phones) the XR panel stands at waist height,
// tilted up toward the viewer, and travels with the player (with them, it
// docks on a controller: see Grab.jsx)
const MENU_HOME = { position: [0, 0.95, -0.75], rotation: [-0.55, 0, 0] };
// a phone's stereo view is blurrier and smaller than a headset's: a bigger panel stays readable
const PHONE_STEREO_MENU_SCALE = 1.5;

function Sky({ passthrough }) {
  const texture = useLoader(THREE.TextureLoader, SKY_URL);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  // passthrough only exists inside an AR session; elsewhere keep the sky
  const hidden = useXR((s) => passthrough && s.mode === 'immersive-ar');

  useEffect(() => {
    if (hidden) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = null;
    };
  }, [texture, scene, gl, hidden]);

  return null;
}

const _eye = new THREE.Vector3();

/**
 * The solid colour as a sphere around the viewer. In an AR session three.js
 * clears to transparent whatever scene.background says (so passthrough shows),
 * so there the colour has to be drawn, like the skybox is.
 */
function SolidDome() {
  const dome = useRef(null);
  useFrame(({ camera }) => dome.current?.position.copy(camera.getWorldPosition(_eye)));
  return (
    <mesh ref={dome} renderOrder={-1000} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[100, 16, 8]} />
      <meshBasicMaterial color={SOLID_BACKGROUND} side={THREE.BackSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Solid colour or the skybox; passthrough shows the skybox until an AR session hides it. */
function Backdrop({ background }) {
  const scene = useThree((s) => s.scene);
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  const solid = background === 'solid';
  useEffect(() => {
    if (!solid || inAR) return;
    const color = new THREE.Color(SOLID_BACKGROUND);
    scene.background = color;
    return () => {
      if (scene.background === color) scene.background = null;
    };
  }, [solid, inAR, scene]);
  if (solid) return inAR ? <SolidDome /> : null;
  return (
    // own boundary so a slow or failed sky never holds back the objects
    <AssetBoundary>
      <Suspense fallback={null}>
        <Sky passthrough={background === 'passthrough'} />
      </Suspense>
    </AssetBoundary>
  );
}

/**
 * What the objects reflect (the metals most): a neutral studio, whatever is
 * behind them (the star sky is too dark to mirror: metals and mercury would
 * look black in it, and stars look wrong against passthrough or a solid
 * colour). Video → Reflections off: nothing (only the lights light them; faster).
 */
function Environment({ reflections }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // (made and disposed in the one effect: made in a memo, React's dev double run would dispose it and keep using it)
  useEffect(() => {
    if (!reflections) return;
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = target.texture;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, reflections]);
  return null;
}


/** A sun casting shadows onto the disc (Video → Shadows), and a soft fill from the sky. */
function Lights({ shadows }) {
  return (
    <>
      <hemisphereLight args={['#dfe8ff', '#3a3f4a', 0.6]} />
      <directionalLight
        position={[1.5, 4, 1]}
        intensity={2}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-1.5}
        shadow-camera-right={1.5}
        shadow-camera-top={1.5}
        shadow-camera-bottom={-1.5}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
        shadow-bias={-0.0005}
      />
    </>
  );
}

/**
 * Out of XR: the window's view as it was. While presenting, three.js copies
 * the headset's pose and projection (and the player's size) onto the scene's
 * camera, and nothing puts them back, so the window would go on showing the
 * last of the headset's view (or nothing). The camera goes back to where it
 * starts, square, its projection the window's; the renderer to the window's size.
 */
function RestoreViewAfterXR() {
  const session = useXR((s) => s.session);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const was = useRef(null);
  useEffect(() => {
    const ended = was.current && !session;
    was.current = session;
    if (!ended) return;
    camera.matrixAutoUpdate = true;
    camera.position.fromArray(WINDOW_START);
    camera.scale.set(1, 1, 1);
    camera.up.set(0, 1, 0);
    camera.lookAt(...LOOK_AT);
    if (camera.isPerspectiveCamera) {
      camera.fov = WINDOW_FOV;
      camera.aspect = size.width / size.height;
      camera.zoom = 1;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    gl.setSize(size.width, size.height, false);
    invalidate();
  }, [session, camera, gl, size, invalidate]);
  return null;
}

/** Gravity turned back on (or off): everything asleep wakes, to fall (or float). */
function WakeOnGravity({ gravity }) {
  const { world } = useRapier();
  useEffect(() => {
    world.forEachRigidBody((body) => body.wakeUp());
  }, [world, gravity]);
  return null;
}

const _yAxis = new THREE.Vector3(0, 1, 0);
const _hand = new THREE.Vector3();

/**
 * Left thumbstick moves (the way the left controller points), right thumbstick
 * turns smoothly about the head, except while that hand's grip holds something
 * (its stick is then the grip's) or, pressed in, it works the panels
 * (`menus`, `onSelect`, `onFocus`: see Grab.jsx). The grip buttons pick up the objects, or carry, dock and undock
 * the panels, or both in mid-air scale the scene (see Grab.jsx); the panels
 * travel with the player. `origin`: ref to the XR origin, whose scale is the
 * player's size (the scene scale's inverse); `onScale(scale)` hears it
 * change; `resetScale` changing puts it back to real size, where you stand.
 */
function Player({ origin, panels, registry, holds, textSize, homeScale, onScale, onResize, resetScale, placing, onPlace, surfaces, previews, menus, onSelect, onFocus, children }) {
  const left = useRef(null);
  const right = useRef(null);
  const probes = useMemo(() => ({ left, right }), []);
  const gl = useThree((s) => s.gl);
  // (the sticks move and turn the player, or work the panels: see Grab.jsx)
  useControllerGrips({
    panels,
    origin,
    registry,
    holds,
    probes,
    textSize,
    home: MENU_HOME,
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
  });
  // back to real size: the floor the real floor again, your head where it was over it
  useEffect(() => {
    const o = origin.current;
    if (!resetScale || !o || o.scale.x === 1) return;
    const head = (gl.xr.isPresenting ? gl.xr.getCamera() : null)?.getWorldPosition(new THREE.Vector3());
    o.updateMatrixWorld();
    const tracked = head ? head.clone().applyMatrix4(o.matrixWorld.clone().invert()) : new THREE.Vector3();
    o.scale.setScalar(1);
    if (head) o.position.copy(head).sub(tracked.applyAxisAngle(_yAxis, o.rotation.y));
    o.position.y = 0;
    onScale(1);
  }, [resetScale]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <XROrigin ref={origin} position={XR_START}>
      <Probes probes={probes} />
      {children}
    </XROrigin>
  );
}

const DRAG = 'pointer'; // who holds an object dragged with Select (see Holds)
const CLICK_SLOP = 6; // px a click may move and still be one (more: orbiting the view)
const DRAG_RANGE = [0.2, 20]; // m: how near and far the mouse wheel brings a dragged object
const STRETCH = { min: 0.2, max: 10 }; // Shift + middle-drag: how much shorter or longer a stretch makes an object, at a time

/**
 * Which pointers work the tools: the mouse, a touch screen, controller rays
 * and their triggers. Not an XR grab or touch pointer: the grips and probes
 * pick objects up themselves (see Grab.jsx).
 */
const toolPointer = (e) => !e.internalPointer || e.pointerType === 'ray';

/**
 * What a shape tool or Paste would make now: { shape, material (an id, or
 * 'random'), transform?, name? }, or null with another tool (or nothing copied).
 */
function placingSpec(tool, material, clip) {
  if (SHAPES[tool]) return { shape: tool, material };
  return tool === 'paste' ? clip : null;
}

const _yaw = new THREE.Quaternion();

/** Something `spec` describes, made at `position`, turned by `quaternion` (Physics.jsx makeBody; a liquid, sand or cloth a pour of grains). */
function made(spec, position, quaternion) {
  const id = spec.material === 'random' ? randomMaterial().id : spec.material;
  const rotation = new THREE.Euler().setFromQuaternion(quaternion);
  return makeBody(spec.shape, id, position.toArray(), [rotation.x, rotation.y, rotation.z], false, {
    ...(spec.transform && { transform: spec.transform }),
    ...(materialById(id).simulation && { fluid: true }),
  });
}

/**
 * The tools on the objects and the disc. Select: press on an object to pick it
 * up; it follows the pointer at the distance it was taken from (the mouse
 * wheel moves it nearer or further), and let go it's thrown. The middle
 * button does the same with any tool, as a controller's grip does; with Shift,
 * it stretches the object along the drag instead (its far side stays put, the
 * side taken follows the pointer: out longer, in shorter), and `onResize(id,
 * transform)` keeps its new shape when it's let go. Copy: a click on an
 * object takes it (`setClip`); Delete: takes it away. The shapes, and Paste:
 * a wireframe (`preview`, a ref) shows where one would go, resting on what the
 * mouse is over, and a click makes it there, of the Material chosen (or a
 * random one) or as copied; in XR the controllers place them, with their
 * triggers (see Grab.jsx). Any pointer over an object puts it in `pointed`
 * (pointer id -> object id), for its label. Returns [handlers(id) for an
 * object's mesh, handlers for the disc's, click(e, id) for the grains'].
 */
function useTools({ tool, material, clip, setClip, registry, bodies, holds, setBodies, pointed, onResize, preview, xrPlaces }) {
  const spec = placingSpec(tool, material, clip);
  const controls = useThree((s) => s.controls);
  const drag = useRef(null); // { id, pointerId, ray, distance, offset }

  useFrame(() => {
    const d = drag.current;
    if (!d) return;
    if (!holds.isHeld(d.id, DRAG)) {
      // a grip took it away
      drag.current = null;
      if (controls) controls.enabled = true;
      return;
    }
    if (d.stretch) stretchTo(d, d.ray.at(d.distance, _hand));
    else holds.move(d.id, DRAG, d.ray.at(d.distance, _hand).add(d.offset));
  });

  /** Shift + middle-drag: the object stretched (or squashed) along the drag, from where it was taken to `to`. */
  const stretchTo = (d, to) => {
    const { start, center, quaternion, transform } = d.stretch;
    const entry = registry.get(d.id);
    if (!entry) return;
    const move = to.clone().sub(start);
    const length = move.length();
    if (length < 0.002) return;
    const axis = move.divideScalar(length);
    // how far it reaches along the drag, each way from its centre (its shape as it was, turned as it is)
    let ahead = 0;
    let behind = 0;
    for (const piece of entry.shape.hull)
      for (const p of piece) {
        const along = _hand.copy(p).applyMatrix3(transform).applyQuaternion(quaternion).dot(axis);
        ahead = Math.max(ahead, along);
        behind = Math.max(behind, -along);
      }
    const span = ahead + behind;
    // out from the centre: longer by the drag; toward it: shorter
    const outward = Math.sign(start.clone().sub(center).dot(axis)) || 1;
    const f = THREE.MathUtils.clamp((span + outward * length) / span, STRETCH.min, STRETCH.max);
    // the far side stays put
    const near = outward > 0 ? behind : ahead;
    const position = center.clone().addScaledVector(axis, outward * (f - 1) * near);
    const g = f - 1;
    const stretch = new THREE.Matrix3().set(
      1 + g * axis.x * axis.x, g * axis.x * axis.y, g * axis.x * axis.z,
      g * axis.y * axis.x, 1 + g * axis.y * axis.y, g * axis.y * axis.z,
      g * axis.z * axis.x, g * axis.z * axis.y, 1 + g * axis.z * axis.z,
    );
    // in its own space: R⁻¹ S R T (it turns rigidly; the stretch is its resizing)
    const turn = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
    const resized = turn.clone().transpose().multiply(stretch).multiply(turn).multiply(transform);
    d.stretch.now = resized;
    holds.move(d.id, DRAG, position, quaternion);
    entry.preview = (entry.preview ?? new THREE.Matrix4()).setFromMatrix3(resized);
  };

  const endDrag = (e) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    e.target?.releasePointerCapture?.(e.pointerId);
    if (d.stretch) {
      // stretched: it keeps its new shape, and stays where it is
      const t = d.stretch.now?.elements;
      if (t) onResize(d.id, t.every((x, i) => Math.abs(x - (i % 4 === 0 ? 1 : 0)) < 1e-4) ? undefined : [...t]);
      holds.release(d.id, DRAG, true);
    } else holds.release(d.id, DRAG);
    if (controls) controls.enabled = true;
  };

  /** Where a click at `e` would put what's being placed: resting on the face under it (turned square to the world). */
  const restingAt = (e) => {
    const normal = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return restingPosition(spec.shape, spec.transform, e.point, normal);
  };

  // the mouse's wireframe: on the face it's over
  const showPreview = (e) => {
    const p = preview.current;
    if (!p) return;
    if (!spec || e.internalPointer || !e.point || drag.current) {
      p.visible = false;
      return;
    }
    p.matrix.compose(restingAt(e), _yaw.identity(), _one).multiply(transformMatrix(spec.transform));
    p.visible = true;
  };
  const hidePreview = (e) => {
    if (!e.internalPointer && preview.current) preview.current.visible = false;
  };

  /** A click (or a controller's trigger) on object `id` (null: the disc), with the tool in use. */
  const click = (e, id = null) => {
    // (an XR pointer's click has no `delta`: reading it throws; a trigger resizing an object isn't a click)
    if (!toolPointer(e) || (!e.internalPointer && (e.delta ?? 0) > CLICK_SLOP) || holds.resizing || tool === 'select') return;
    if (tool === 'copy' || tool === 'delete') {
      if (id == null) return;
      e.stopPropagation();
      const def = registry.get(id)?.def ?? bodies.find((b) => b.id === id);
      if (!def) return;
      if (tool === 'delete') setBodies((list) => list.filter((b) => b.id !== id));
      else setClip({ shape: def.shape, material: def.material, ...(def.transform && { transform: def.transform }), name: `${materialById(def.material).name} ${shapeOf(def.shape).label}` });
      return;
    }
    if (!spec || !e.point) return;
    // (in XR the triggers place them, at their wireframes)
    if (e.internalPointer && xrPlaces) return;
    e.stopPropagation();
    const body = made(spec, restingAt(e), _yaw.identity());
    setBodies((list) => withMade(list, body));
  };

  const cursor = (value) => (document.body.style.cursor = value);
  const handlers = (id) => ({
    onPointerDown: (e) => {
      // Select's left button, or with any tool the middle one (the mouse's grip)
      const button = e.button ?? 0;
      if (!((tool === 'select' && button === 0) || (button === 1 && !e.internalPointer))) return;
      if (!toolPointer(e) || drag.current || holds.resizing) return;
      e.stopPropagation();
      if (!holds.take(id, DRAG)) return;
      const position = registry.get(id).mesh.current.getWorldPosition(new THREE.Vector3());
      drag.current = { id, pointerId: e.pointerId, ray: e.ray.clone(), distance: e.distance, offset: position.clone().sub(e.point) };
      if (button === 1 && e.shiftKey) {
        // Shift: stretching it, not moving it
        const h = holds.map.get(id);
        const def = registry.get(id).def;
        drag.current.stretch = {
          start: e.point.clone(),
          center: h.position.clone(),
          quaternion: h.quaternion.clone(),
          transform: def.transform ? new THREE.Matrix3().fromArray(def.transform) : new THREE.Matrix3(),
          now: null,
        };
      }
      e.target?.setPointerCapture?.(e.pointerId);
      if (controls) controls.enabled = false;
      cursor('grabbing');
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (d?.pointerId === e.pointerId) d.ray.copy(e.ray);
      showPreview(e);
    },
    onPointerUp: (e) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      endDrag(e);
      cursor('grab');
    },
    onPointerCancel: endDrag,
    onWheel: (e) => {
      const d = drag.current;
      if (!d) return;
      e.stopPropagation();
      const deltaY = e.deltaY ?? e.nativeEvent?.deltaY ?? 0;
      d.distance = THREE.MathUtils.clamp(d.distance * Math.exp(deltaY * 0.001), ...DRAG_RANGE);
    },
    onClick: (e) => click(e, id),
    onPointerOver: (e) => {
      if (!toolPointer(e)) return;
      e.stopPropagation();
      pointed.set(e.pointerId, id);
      if (!e.internalPointer) cursor(tool === 'select' ? 'grab' : 'copy');
    },
    onPointerOut: (e) => {
      if (pointed.get(e.pointerId) === id) pointed.delete(e.pointerId);
      if (!e.internalPointer && !drag.current) cursor('');
      hidePreview(e);
    },
  });
  const disc = { onClick: (e) => click(e, null), onPointerMove: showPreview, onPointerOut: hidePreview };
  return [handlers, disc, click];
}

const _one = new THREE.Vector3(1, 1, 1);
const WIRE_MATERIAL = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false });

/** A wireframe of what `spec` would make, placed (its matrix) by whoever shows it. */
function Preview({ spec, previewRef }) {
  return (
    <lineSegments
      ref={previewRef}
      geometry={wireOf(spec?.shape ?? 'cube')}
      material={WIRE_MATERIAL}
      matrixAutoUpdate={false}
      visible={false}
      renderOrder={5}
      raycast={() => null}
    />
  );
}

const GRID = { step: 0.1, radius: 1, height: 2 }; // m: Video → Show Grid: lines this far apart, over the disc, up to this high

/** Video → Show Grid: thin grey lines every 10 cm through the space over the disc (a cylinder as wide as it, 2 m high). */
function Grid() {
  const geometry = useMemo(() => {
    const points = [];
    const n = Math.round(GRID.radius / GRID.step);
    const levels = Math.round(GRID.height / GRID.step);
    for (let i = -n; i <= n; i++) {
      const a = i * GRID.step;
      const reach = Math.sqrt(Math.max(0, GRID.radius ** 2 - a * a)); // (as far as the disc's edge)
      for (let k = 0; k <= levels; k++) {
        const y = k * GRID.step;
        points.push(-reach, y, a, reach, y, a); // along x
        points.push(a, y, -reach, a, y, reach); // along z
      }
      for (let j = -n; j <= n; j++) {
        const b = j * GRID.step;
        if (a * a + b * b <= GRID.radius ** 2) points.push(a, 0, b, a, GRID.height, b); // up
      }
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#9aa0a8" transparent opacity={0.22} depthWrite={false} />
    </lineSegments>
  );
}

/**
 * `panels`: the panels' template (Options, the View panel where a headset can
 * be used, and Tools; see menu.js), `onSelect(id)` for their buttons.
 * `bodies` / `setBodies`: the objects (see Physics.jsx); `registry`: their bodies, by id.
 * `menuOverlay`: the page shows Options over the scene (Phone AR), so no panel in it.
 */
export default function Scene({ state, panels, onSelect, menuOverlay, phone, bodies, setBodies, registry, onScale, resetScale, setClip }) {
  const inSession = useXR((s) => s.mode === 'immersive-vr' || s.mode === 'immersive-ar');
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  // a phone's AR session drawn as two lens-corrected eyes
  const phoneStereo = phone && inAR && state.stereo;
  // the 1-second stare is for hands-free use: controllers point and click instead
  const hasControllers = useXR((s) => s.inputSourceStates.some((input) => input.type === 'controller'));
  const immersive = inSession || state.handheld;
  // the motion-sensor view has no AR session: passthrough is the rear camera
  const cameraPassthrough = state.handheld && state.passthrough;
  const [cameraFailed, setCameraFailed] = useState(false);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  // Video's costly effects: the looks made again for Refraction and Surface Detail (before the objects render), and how many particles
  setLookQuality({ refraction: state.refraction, surfaceDetail: state.surfaceDetail });
  particles.density = state.particles === 'low' ? 0.35 : 1;
  const discCollider = useRef(null);
  const origin = useRef(null);
  const pointed = useMemo(() => new Map(), []);
  const viewScale = () => origin.current?.scale.x ?? 1;
  const holds = useMemo(() => new Holds(registry), [registry]);
  // an object resized with both hands keeps its new size (see Grab.jsx)
  const onResize = (id, transform) => setBodies((list) => list.map((b) => (b.id === id ? { ...b, transform } : b)));
  // the shapes' and Paste's wireframes: the mouse's, and each controller's
  const mousePreview = useRef(null);
  const leftPreview = useRef(null);
  const rightPreview = useRef(null);
  const previews = useMemo(() => ({ left: leftPreview, right: rightPreview }), []);
  const discMesh = useRef(null);
  const spec = placingSpec(state.tool, state.material, state.clip);
  const placing = useRef(spec);
  placing.current = spec;
  const surfaces = () => [discMesh.current, ...[...registry.values()].map((e) => e.mesh.current)].filter(Boolean);
  const onPlace = (what, position, quaternion) => {
    const body = made(what, position, quaternion);
    setBodies((list) => withMade(list, body));
  };
  const [handlers, discHandlers, click] = useTools({
    tool: state.tool,
    material: state.material,
    clip: state.clip,
    setClip,
    registry,
    bodies,
    holds,
    setBodies,
    pointed,
    onResize,
    preview: mousePreview,
    xrPlaces: inSession && hasControllers,
  });
  const menuPanel = useRef(null);
  const viewPanel = useRef(null);
  const toolsPanel = useRef(null);
  const panelRefs = useMemo(() => ({ menu: menuPanel, view: viewPanel, tools: toolsPanel }), []);
  const { options, view, tools } = panels;
  // the panels' templates by dock key, for the sticks, and what they've lit in each
  const menus = useRef(null);
  menus.current = { menu: options, view, tools };
  const [stickFocus, setStickFocus] = useState({});
  return (
    <>
      {cameraPassthrough && !cameraFailed ? (
        <CameraBackground
          split={state.stereo}
          onError={(e) => {
            console.warn('[physics-sandbox] camera unavailable, showing the skybox instead:', e?.message ?? e);
            setCameraFailed(true);
          }}
        />
      ) : (
        <Backdrop background={state.background} />
      )}
      <FramePacing seeThrough={false} vsync={state.vsync} />
      <RestoreViewAfterXR />
      {state.view === 'sbs' && !immersive && <SideBySide />}
      {state.view === 'interlaced' && !immersive && <Interlaced />}
      {phoneStereo && <PhoneStereoXR />}
      {phoneStereo && state.passthrough && (
        <PhoneStereoCameraFeed
          onUnavailable={(reason) =>
            console.warn(`[physics-sandbox] no per-eye camera image (${reason}); the browser's camera view shows behind instead`)
          }
        />
      )}
      <Environment reflections={state.reflections} />
      <Lights shadows={state.shadows} />
      <Physics gravity={state.gravity ? GRAVITY : NO_GRAVITY} paused={state.paused}>
        <WakeOnGravity gravity={state.gravity} />
        <Disc colliderRef={discCollider} meshRef={discMesh} handlers={discHandlers} />
        <SandboxBodies bodies={bodies} setBodies={setBodies} registry={registry} holds={holds} handlers={handlers} />
        <AirDrag registry={registry} />
        <ContactSounds registry={registry} disc={discCollider} holds={holds} onDeform={onResize} />
        <Fluids
          bodies={bodies}
          setBodies={setBodies}
          onClick={click}
          smooth={state.liquidSurfaces}
          // (cloth: picked up by Select's left button, or the middle one)
          grabs={(e) => !e.internalPointer && ((state.tool === 'select' && (e.button ?? 0) === 0) || e.button === 1)}
        />
      </Physics>
      <Particles registry={registry} />
      {state.glowLights && <GlowLights registry={registry} />}
      <MaterialLabels registry={registry} holds={holds} pointed={pointed} viewScale={viewScale} />
      {state.grid && <Grid />}
      <Preview spec={spec} previewRef={mousePreview} />
      <Preview spec={spec} previewRef={leftPreview} />
      <Preview spec={spec} previewRef={rightPreview} />
      <Player
        origin={origin}
        onScale={onScale}
        onResize={onResize}
        resetScale={resetScale}
        placing={placing}
        onPlace={onPlace}
        surfaces={surfaces}
        previews={previews}
        menus={menus}
        onSelect={onSelect}
        onFocus={setStickFocus}
        panels={panelRefs}
        registry={registry}
        holds={holds}
        textSize={state.textSize}
        homeScale={phone && state.stereo ? PHONE_STEREO_MENU_SCALE : 1}
      >
        {immersive && !menuOverlay && <XRPanel panel={options} onSelect={onSelect} groupRef={menuPanel} focusKey={stickFocus.menu} />}
        {inSession && view && <XRPanel panel={view} onSelect={onSelect} groupRef={viewPanel} focusKey={stickFocus.view} />}
        {inSession && <XRPanel panel={tools} onSelect={onSelect} groupRef={toolsPanel} focusKey={stickFocus.tools} />}
      </Player>
      {inSession && hasControllers && state.controllerGuide && <ControllerGuide textSize={state.textSize} />}
      {immersive && !hasControllers && <GazeReticle />}
      {state.handheld ? (
        <CardboardRig split={state.stereo} />
      ) : (
        <IfInSessionMode deny={['immersive-vr', 'immersive-ar']}>
          {/* (the middle button grabs objects, so it doesn't dolly: the wheel does) */}
          <OrbitControls makeDefault target={LOOK_AT} enableDamping minDistance={0.3} maxDistance={20} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} />
        </IfInSessionMode>
      )}
    </>
  );
}
