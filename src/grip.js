import * as THREE from 'three';

// Touch controllers read straight from the XR session, for the grip controls
// (see Grab.jsx), so they work at any distance.

const SQUEEZE = 1; // xr-standard gamepad button index
const STICK_DEAD = 0.2; // thumbstick tilt ignored below this

/** A haptic pulse on `gamepad`'s controller, `intensity` (0 to 1) for `ms`. */
export function pulse(gamepad, intensity, ms) {
  const actuator = gamepad?.hapticActuators?.[0];
  if (actuator?.pulse) actuator.pulse(intensity, ms)?.catch?.(() => {});
  else gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity })?.catch?.(() => {});
}

/**
 * Each controller's state in world space: { grip (Matrix4), position, ray,
 * rayMatrix (its pointing frame: -Z along the ray), squeeze, stick ({ x:
 * right, y: down }, 0 inside the dead zone), gamepad }, keyed by hand. Poses come relative to the XR origin,
 * which locomotion moves, so they're carried through its world matrix.
 */
export function readControllers(frame, referenceSpace, origin) {
  const hands = {};
  for (const source of frame.session.inputSources) {
    if (!source.gripSpace || !source.gamepad) continue; // tracked hands have no grip button
    if (source.handedness !== 'left' && source.handedness !== 'right') continue;
    const gripPose = frame.getPose(source.gripSpace, referenceSpace);
    if (!gripPose) continue;
    const grip = new THREE.Matrix4().fromArray(gripPose.transform.matrix).premultiply(origin.matrixWorld);
    const ray = new THREE.Ray();
    const rayMatrix = grip.clone();
    const rayPose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (rayPose) {
      rayMatrix.fromArray(rayPose.transform.matrix).premultiply(origin.matrixWorld);
      ray.origin.setFromMatrixPosition(rayMatrix);
      ray.direction.set(0, 0, -1).transformDirection(rayMatrix);
    }
    // xr-standard: the thumbstick is axes 2 and 3 (0 and 1 on controllers with only a stick)
    const axes = source.gamepad.axes;
    const axis = (i) => {
      const v = (axes.length >= 4 ? axes[2 + i] : axes[i]) ?? 0;
      return Math.abs(v) < STICK_DEAD ? 0 : v;
    };
    hands[source.handedness] = {
      grip,
      position: new THREE.Vector3().setFromMatrixPosition(grip),
      ray,
      rayMatrix,
      stick: { x: axis(0), y: axis(1) },
      squeeze: Boolean(source.gamepad.buttons[SQUEEZE]?.pressed),
      gamepad: source.gamepad,
    };
  }
  return hands;
}
