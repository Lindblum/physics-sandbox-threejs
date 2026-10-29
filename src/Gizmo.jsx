import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// The selected object's frame (Select picks one; see Scene.jsx): its own three
// axes, as turned as it is, a line each from its middle out past its side, a
// red cube on the end of X, a green on Y's, a blue on Z's. Dragging a cube (the
// mouse, or a controller's ray and trigger) stretches the object along that
// axis: its far side stays put, its near side follows the cube (out longer,
// in shorter), and `onResize(id, transform)` keeps the new shape when it's let
// go: its colliders, volume and mass with it.

const AXES = [
  { axis: new THREE.Vector3(1, 0, 0), color: '#ff4a4a' },
  { axis: new THREE.Vector3(0, 1, 0), color: '#4ade5a' },
  { axis: new THREE.Vector3(0, 0, 1), color: '#4a8cff' },
];
const HANDLE_M = 0.02; // a cube's edge, life size (bigger further off, as the labels are)
const BEYOND_M = 0.03; // how far past the object's side its cube sits
const STRETCH = { min: 0.2, max: 10 }; // how much shorter or longer one drag makes it
const GIZMO = 'gizmo'; // who holds an object being stretched (see Holds)

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();

/** How far shape `entry`'s hull, resized by `matrix` (a Matrix3), reaches along local `axis`: { ahead, behind }. */
function reachAlong(entry, matrix, axis) {
  let ahead = 0;
  let behind = 0;
  for (const piece of entry.shape.hull)
    for (const p of piece) {
      const along = _v.copy(p).applyMatrix3(matrix).dot(axis);
      ahead = Math.max(ahead, along);
      behind = Math.max(behind, -along);
    }
  return { ahead, behind };
}

/** Where along the line through `origin` in (unit) direction `dir` the ray comes nearest it, or null if they're parallel. */
function alongLine(ray, origin, dir) {
  const b = dir.dot(ray.direction);
  const denom = 1 - b * b;
  if (denom < 1e-4) return null;
  _v.subVectors(origin, ray.origin);
  return (b * ray.direction.dot(_v) - dir.dot(_v)) / denom;
}

/**
 * The frame of object `selected` (an id, or null), and its cubes' dragging.
 * `registry`, `holds`: Physics.jsx's; `viewScale()`: the world's scale in XR.
 */
export function AxisGizmo({ selected, registry, holds, onResize, viewScale }) {
  const group = useRef(null);
  const lines = useRef([]);
  const handles = useRef([]);
  const drag = useRef(null); // { id, pointerId, index, centre, dir, quaternion, transform, ahead, behind, from, now }
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls);
  const lineMaterials = useMemo(() => AXES.map(({ color }) => new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true })), []);
  const handleMaterials = useMemo(() => AXES.map(({ color }) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true })), []);
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), []);
  const handleGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(
    () => () => {
      [...lineMaterials, ...handleMaterials].forEach((m) => m.dispose());
      lineGeometry.dispose();
      handleGeometry.dispose();
    },
    [lineMaterials, handleMaterials, lineGeometry, handleGeometry],
  );

  useFrame(() => {
    const g = group.current;
    const entry = selected != null ? registry.get(selected) : null;
    const body = entry?.body.current;
    if (!g || !body || !entry.mesh.current) {
      if (g) g.visible = false;
      if (drag.current) end();
      return;
    }
    g.visible = true;
    g.position.copy(body.translation());
    g.quaternion.copy(body.rotation());
    // the cubes the same size on screen however far, but never smaller than life size up close
    const viewer = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    const k = viewScale();
    const size = HANDLE_M * k * Math.max(1, viewer.getWorldPosition(_p).distanceTo(g.position) / (1.2 * k));
    const matrix = _m3.setFromMatrix4(entry.preview ?? entry.base);
    AXES.forEach(({ axis }, i) => {
      const length = reachAlong(entry, matrix, axis).ahead + BEYOND_M * k + size / 2;
      const line = lines.current[i];
      const handle = handles.current[i];
      if (!line || !handle) return;
      // (each line is along x, 0 to 1: turned onto its axis and stretched)
      line.quaternion.setFromUnitVectors(AXES[0].axis, axis);
      line.scale.setScalar(length);
      handle.position.copy(axis).multiplyScalar(length);
      handle.scale.setScalar(drag.current?.index === i ? size * 1.3 : size);
    });
  });

  /** Lets go of the stretch: it keeps its new shape, and stays where it is. */
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (controls) controls.enabled = true;
    if (!d) return;
    const t = d.now?.elements;
    if (t) onResize(d.id, t.every((x, i) => Math.abs(x - (i % 4 === 0 ? 1 : 0)) < 1e-4) ? undefined : [...t]);
    holds.release(d.id, GIZMO, true);
  };

  const handlers = (index) => ({
    onPointerDown: (e) => {
      if ((e.button ?? 0) !== 0 || drag.current || selected == null) return;
      e.stopPropagation();
      const entry = registry.get(selected);
      if (!entry || holds.isHeld(selected) || !holds.take(selected, GIZMO)) return;
      const h = holds.map.get(selected);
      const transform = entry.def.transform ? new THREE.Matrix3().fromArray(entry.def.transform) : new THREE.Matrix3();
      const dir = AXES[index].axis.clone().applyQuaternion(h.quaternion);
      const { ahead, behind } = reachAlong(entry, transform, AXES[index].axis);
      const from = alongLine(e.ray, h.position, dir);
      drag.current = { id: selected, pointerId: e.pointerId, index, centre: h.position.clone(), dir, quaternion: h.quaternion.clone(), transform, ahead, behind, from: from ?? 0, now: null };
      e.target?.setPointerCapture?.(e.pointerId);
      if (controls) controls.enabled = false;
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (d?.pointerId !== e.pointerId) return;
      e.stopPropagation();
      const entry = registry.get(d.id);
      const at = alongLine(e.ray, d.centre, d.dir);
      if (!entry || at == null) return;
      // out along the axis: longer by as far as the cube's moved; back: shorter
      const span = d.ahead + d.behind;
      const f = THREE.MathUtils.clamp((span + at - d.from) / span, STRETCH.min, STRETCH.max);
      // in its own frame: that axis scaled, after the resizing it had
      const scale = new THREE.Matrix3().identity();
      scale.elements[index * 4] = f;
      d.now = scale.multiply(d.transform);
      // the far side stays put
      holds.move(d.id, GIZMO, _p.copy(d.centre).addScaledVector(d.dir, (f - 1) * d.behind), _q.copy(d.quaternion));
      entry.preview = (entry.preview ?? new THREE.Matrix4()).setFromMatrix3(d.now);
    },
    onPointerUp: (e) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      e.stopPropagation();
      e.target?.releasePointerCapture?.(e.pointerId);
      end();
    },
    onPointerCancel: () => end(),
    onPointerOver: (e) => {
      e.stopPropagation();
      if (!e.internalPointer) document.body.style.cursor = 'move';
    },
    onPointerOut: (e) => {
      if (!e.internalPointer && !drag.current) document.body.style.cursor = '';
    },
  });

  return (
    <group ref={group} visible={false}>
      {AXES.map((_, i) => (
        <group key={i}>
          <lineSegments ref={(l) => (lines.current[i] = l)} geometry={lineGeometry} material={lineMaterials[i]} renderOrder={998} raycast={() => null} />
          <mesh
            ref={(m) => (handles.current[i] = m)}
            geometry={handleGeometry}
            material={handleMaterials[i]}
            renderOrder={999}
            userData={{ gizmo: true }}
            // (not pointed at while hidden)
            raycast={function (raycaster, hits) {
              if (group.current?.visible) THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
            }}
            {...handlers(i)}
          />
        </group>
      ))}
    </group>
  );
}
