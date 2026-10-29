import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IfInSessionMode, XROrigin, useXR, useXRControllerLocomotion } from '@react-three/xr';
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
import { AirDrag, ContactSounds, Disc, GlowLights, Holds, MaterialLabels, Particles, SandboxBodies, makeBody, withMade } from './Physics.jsx';
import { shapeOf } from './shapes.js';
import { randomMaterial } from './materials.js';
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
 * What the objects reflect (the metals most): the skybox when it is
 * showing, otherwise a neutral studio (the stars would look wrong against
 * passthrough or a solid colour). Video → Reflections off: nothing (only the
 * lights light them; faster).
 */
function Environment({ sky, reflections }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const environment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let target;
    if (sky) {
      sky.mapping = THREE.EquirectangularReflectionMapping;
      sky.colorSpace = THREE.SRGBColorSpace;
      target = pmrem.fromEquirectangular(sky);
    } else {
      const room = new RoomEnvironment();
      target = pmrem.fromScene(room, 0.04);
      room.dispose();
    }
    pmrem.dispose();
    return target;
  }, [gl, sky]);
  useEffect(() => () => environment.dispose(), [environment]);
  useEffect(() => {
    if (!reflections) return;
    scene.environment = environment.texture;
    return () => {
      if (scene.environment === environment.texture) scene.environment = null;
    };
  }, [scene, environment, reflections]);
  return null;
}

function SkyEnvironment({ reflections }) {
  return <Environment sky={useLoader(THREE.TextureLoader, SKY_URL)} reflections={reflections} />;
}

/** A sun casting shadows onto the disc, and a soft fill from the sky. */
function Lights() {
  return (
    <>
      <hemisphereLight args={['#dfe8ff', '#3a3f4a', 0.6]} />
      <directionalLight
        position={[1.5, 4, 1]}
        intensity={2}
        castShadow
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

/** Gravity turned back on (or off): everything asleep wakes, to fall (or float). */
function WakeOnGravity({ gravity }) {
  const { world } = useRapier();
  useEffect(() => {
    world.forEachRigidBody((body) => body.wakeUp());
  }, [world, gravity]);
  return null;
}

const _head = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _hand = new THREE.Vector3();

/**
 * Left thumbstick moves, right thumbstick turns smoothly about the head,
 * except while that hand's grip holds something (its stick is then the
 * grip's). The grip buttons pick up the objects, or carry, dock and undock
 * the panels, or both in mid-air scale the scene (see Grab.jsx); the panels
 * travel with the player. `origin`: ref to the XR origin, whose scale is the
 * player's size (the scene scale's inverse); `onScale(scale)` hears it
 * change; `resetScale` changing puts it back to real size, where you stand.
 */
function Player({ origin, panels, registry, holds, textSize, homeScale, onScale, resetScale, children }) {
  const left = useRef(null);
  const right = useRef(null);
  const probes = useMemo(() => ({ left, right }), []);
  const gl = useThree((s) => s.gl);
  const holding = useControllerGrips({ panels, origin, registry, holds, probes, textSize, home: MENU_HOME, homeScale, onScale });
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
  useXRControllerLocomotion(
    (velocity, turn, delta, state) => {
      const o = origin.current;
      if (!o) return;
      // (as fast for your size whatever the scene's scale)
      if (!holding.current.left) o.position.addScaledVector(velocity, delta * o.scale.x);
      turn = -turn; // (the stick pushed right turns you right)
      if (!turn || holding.current.right) return;
      // swing the origin around the head so turning doesn't move the viewer
      state.camera.getWorldPosition(_head);
      const dx = o.position.x - _head.x;
      const dz = o.position.z - _head.z;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      o.position.x = _head.x + dx * c + dz * s;
      o.position.z = _head.z - dx * s + dz * c;
      o.rotation.y += turn;
    },
    { speed: 1.5 },
    { type: 'smooth', speed: 1.5 },
  );
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

/**
 * Which pointers work the tools: the mouse, a touch screen, controller rays
 * and their triggers. Not an XR grab or touch pointer: the grips and probes
 * pick objects up themselves (see Grab.jsx).
 */
const toolPointer = (e) => !e.internalPointer || e.pointerType === 'ray';

/**
 * The tools on the objects and the disc. Select: press on an object to pick it
 * up; it follows the pointer at the distance it was taken from (the mouse
 * wheel moves it nearer or further), and let go it's thrown. The shapes: a
 * click (or a controller's trigger) on the disc or an object makes one there,
 * resting on the face clicked, of the Material chosen (or a random one). Any
 * pointer over an object puts it in `pointed` (pointer id -> object id), for
 * its label. Returns [handlers(id) for an object's mesh, the disc's onClick].
 */
function useTools({ tool, material, registry, holds, setBodies, pointed }) {
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
    holds.move(d.id, DRAG, d.ray.at(d.distance, _hand).add(d.offset));
  });

  const endDrag = (e) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    e.target?.releasePointerCapture?.(e.pointerId);
    holds.release(d.id, DRAG);
    if (controls) controls.enabled = true;
  };

  const make = (e) => {
    // (an XR pointer's click has no `delta`: reading it throws)
    if (tool === 'select' || !toolPointer(e) || (!e.internalPointer && (e.delta ?? 0) > CLICK_SLOP) || !e.point) return;
    e.stopPropagation();
    const half = shapeOf(tool).radius;
    // out from the face clicked, resting on it (a sliver apart, so they don't start overlapping)
    const normal = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const at = e.point.clone().addScaledVector(normal, half + 0.005);
    const made = material === 'random' ? randomMaterial().id : material;
    setBodies((list) => withMade(list, makeBody(tool, made, at.toArray())));
  };

  const cursor = (value) => (document.body.style.cursor = value);
  const handlers = (id) => ({
    onPointerDown: (e) => {
      if (tool !== 'select' || !toolPointer(e) || (e.button ?? 0) !== 0 || drag.current) return;
      e.stopPropagation();
      if (!holds.take(id, DRAG)) return;
      const position = registry.get(id).mesh.current.getWorldPosition(new THREE.Vector3());
      drag.current = { id, pointerId: e.pointerId, ray: e.ray.clone(), distance: e.distance, offset: position.sub(e.point) };
      e.target?.setPointerCapture?.(e.pointerId);
      if (controls) controls.enabled = false;
      cursor('grabbing');
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (d?.pointerId === e.pointerId) d.ray.copy(e.ray);
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
    onClick: make,
    onPointerOver: (e) => {
      if (!toolPointer(e)) return;
      e.stopPropagation();
      pointed.set(e.pointerId, id);
      if (!e.internalPointer) cursor(tool === 'select' ? 'grab' : 'copy');
    },
    onPointerOut: (e) => {
      if (pointed.get(e.pointerId) === id) pointed.delete(e.pointerId);
      if (!e.internalPointer && !drag.current) cursor('');
    },
  });
  return [handlers, make];
}

/**
 * `panels`: the panels' template (Options, the View panel where a headset can
 * be used, and Tools; see menu.js), `onSelect(id)` for their buttons.
 * `bodies` / `setBodies`: the objects (see Physics.jsx); `registry`: their bodies, by id.
 * `menuOverlay`: the page shows Options over the scene (Phone AR), so no panel in it.
 */
export default function Scene({ state, panels, onSelect, menuOverlay, phone, bodies, setBodies, registry, onScale, resetScale }) {
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
  // the skybox is behind the objects: Skybox, or Passthrough before an AR session
  const showsSky = state.background === 'skybox' || (state.background === 'passthrough' && !inAR && !cameraPassthrough);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  const discCollider = useRef(null);
  const origin = useRef(null);
  const pointed = useMemo(() => new Map(), []);
  const viewScale = () => origin.current?.scale.x ?? 1;
  const holds = useMemo(() => new Holds(registry), [registry]);
  const [handlers, make] = useTools({ tool: state.tool, material: state.material, registry, holds, setBodies, pointed });
  const menuPanel = useRef(null);
  const viewPanel = useRef(null);
  const toolsPanel = useRef(null);
  const panelRefs = useMemo(() => ({ menu: menuPanel, view: viewPanel, tools: toolsPanel }), []);
  const { options, view, tools } = panels;
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
      {showsSky ? (
        <AssetBoundary fallback={<Environment reflections={state.reflections} />}>
          <Suspense fallback={null}>
            <SkyEnvironment reflections={state.reflections} />
          </Suspense>
        </AssetBoundary>
      ) : (
        <Environment reflections={state.reflections} />
      )}
      <Lights />
      <Physics gravity={state.gravity ? GRAVITY : NO_GRAVITY} paused={state.paused}>
        <WakeOnGravity gravity={state.gravity} />
        <Disc onClick={make} colliderRef={discCollider} />
        <SandboxBodies bodies={bodies} setBodies={setBodies} registry={registry} holds={holds} handlers={handlers} />
        <AirDrag registry={registry} />
        <ContactSounds registry={registry} disc={discCollider} />
      </Physics>
      <Particles registry={registry} />
      <GlowLights registry={registry} />
      <MaterialLabels registry={registry} holds={holds} pointed={pointed} viewScale={viewScale} />
      <Player
        origin={origin}
        onScale={onScale}
        resetScale={resetScale}
        panels={panelRefs}
        registry={registry}
        holds={holds}
        textSize={state.textSize}
        homeScale={phone && state.stereo ? PHONE_STEREO_MENU_SCALE : 1}
      >
        {immersive && !menuOverlay && <XRPanel panel={options} onSelect={onSelect} groupRef={menuPanel} />}
        {inSession && view && <XRPanel panel={view} onSelect={onSelect} groupRef={viewPanel} />}
        {inSession && <XRPanel panel={tools} onSelect={onSelect} groupRef={toolsPanel} />}
      </Player>
      {inSession && hasControllers && state.controllerGuide && <ControllerGuide textSize={state.textSize} />}
      {immersive && !hasControllers && <GazeReticle />}
      {state.handheld ? (
        <CardboardRig split={state.stereo} />
      ) : (
        <IfInSessionMode deny={['immersive-vr', 'immersive-ar']}>
          <OrbitControls makeDefault target={LOOK_AT} enableDamping minDistance={0.3} maxDistance={20} />
        </IfInSessionMode>
      )}
    </>
  );
}
