import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// The selected object's frame (Select picks one; see Scene.jsx): its own three
// axes, as turned as it is, a line each from its middle out past its side, a
// red cube on the end of X, a green on Y's, a blue on Z's. Dragging a cube (the
// mouse's left or middle button, a controller's ray and trigger, or its grip:
// the probe on the cube, or the ray at it) stretches the object along that
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
 * The stretching itself, by whoever does it: the mouse or a controller's ray
 * (a pointer, by its id) or a grip (by its hand). `selected`, `handles` (the
 * cubes' meshes) are AxisGizmo's, each frame; `onResize` Scene's.
 */
export class Stretcher {
  constructor(registry, holds) {
    this.registry = registry;
    this.holds = holds;
    this.onResize = null;
    this.selected = null; // the object whose frame shows, or null
    this.handles = [];
    this.drag = null; // { id, by, index, centre, dir, quaternion, transform, ahead, behind, from, now }
  }

  /** Whether the frame shows. */
  get shown() {
    return this.selected != null && Boolean(this.handles[0]?.parent?.parent?.visible);
  }

  /** The cube nearest world point `point`, within `reach` of its side: its index, or null. */
  handleNear(point, reach) {
    if (!this.shown) return null;
    let best = null;
    this.handles.forEach((h, i) => {
      const d = h.getWorldPosition(_p).distanceTo(point) - h.scale.x / 2;
      if (d <= reach && (!best || d < best.d)) best = { i, d };
    });
    return best?.i ?? null;
  }

  /** The cube `raycaster` hits first: { index, distance }, or null. */
  handlePointed(raycaster) {
    if (!this.shown) return null;
    const hit = raycaster.intersectObjects(this.handles, false)[0];
    return hit ? { index: this.handles.indexOf(hit.object), distance: hit.distance } : null;
  }

  /** Where along the line through `centre` in direction `dir` `at` (a ray, or a world point) is, or null. */
  along(at, centre, dir) {
    if (at.isVector3) return _v.subVectors(at, centre).dot(dir);
    return alongLine(at, centre, dir);
  }

  /** `by` starts dragging cube `index`, from `at` (a ray or a world point). Returns whether it did. */
  begin(index, by, at) {
    const id = this.selected;
    const entry = id != null ? this.registry.get(id) : null;
    if (this.drag || !entry) return false;
    // (taken from whoever held it)
    const h0 = this.holds.map.get(id);
    if (h0) this.holds.release(id, h0.by, true);
    if (!this.holds.take(id, GIZMO)) return false;
    const h = this.holds.map.get(id);
    const transform = entry.def.transform ? new THREE.Matrix3().fromArray(entry.def.transform) : new THREE.Matrix3();
    const dir = AXES[index].axis.clone().applyQuaternion(h.quaternion);
    const { ahead, behind } = reachAlong(entry, transform, AXES[index].axis);
    const centre = h.position.clone();
    this.drag = { id, by, index, centre, dir, quaternion: h.quaternion.clone(), transform, ahead, behind, from: this.along(at, centre, dir) ?? 0, now: null };
    return true;
  }

  /** `by`'s cube to `at` (a ray or a world point): out along the axis longer by as far as it's moved, back shorter; the far side stays put. */
  move(by, at) {
    const d = this.drag;
    if (d?.by !== by) return;
    const entry = this.registry.get(d.id);
    const along = this.along(at, d.centre, d.dir);
    if (!entry || along == null) return;
    const span = d.ahead + d.behind;
    const f = THREE.MathUtils.clamp((span + along - d.from) / span, STRETCH.min, STRETCH.max);
    // in its own frame: that axis scaled, after the resizing it had
    const scale = new THREE.Matrix3().identity();
    scale.elements[d.index * 4] = f;
    d.now = scale.multiply(d.transform);
    this.holds.move(d.id, GIZMO, _p.copy(d.centre).addScaledVector(d.dir, (f - 1) * d.behind), _q.copy(d.quaternion));
    entry.preview = (entry.preview ?? new THREE.Matrix4()).setFromMatrix3(d.now);
  }

  /** `by` lets go (or whoever's dragging, with no `by`): it keeps its new shape, and stays where it is. */
  end(by) {
    const d = this.drag;
    if (!d || (by !== undefined && d.by !== by)) return;
    this.drag = null;
    const t = d.now?.elements;
    if (t) this.onResize?.(d.id, t.every((x, i) => Math.abs(x - (i % 4 === 0 ? 1 : 0)) < 1e-4) ? undefined : [...t]);
    this.holds.release(d.id, GIZMO, true);
  }
}

/**
 * The frame of object `selected` (an id, or null), its cubes dragged by the
 * mouse (left or middle button) or a controller's ray and trigger; a grip's
 * are Grab.jsx's. `stretcher`: a Stretcher; `viewScale()`: the world's scale in XR.
 */
export function AxisGizmo({ selected, stretcher, viewScale }) {
  const group = useRef(null);
  const lines = useRef([]);
  const handles = useRef([]);
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
    stretcher.selected = selected;
    stretcher.handles = handles.current;
    const entry = selected != null ? stretcher.registry.get(selected) : null;
    const body = entry?.body.current;
    if (!g || !body || !entry.mesh.current) {
      if (g) g.visible = false;
      stretcher.end();
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
      handle.scale.setScalar(stretcher.drag?.index === i ? size * 1.3 : size);
    });
  });

  const pointer = (e) => `pointer:${e.pointerId}`;
  const handlers = (index) => ({
    onPointerDown: (e) => {
      if (![0, 1].includes(e.button ?? 0) || !e.ray) return;
      e.stopPropagation();
      if (!stretcher.begin(index, pointer(e), e.ray)) return;
      e.target?.setPointerCapture?.(e.pointerId);
      if (controls) controls.enabled = false;
    },
    onPointerMove: (e) => {
      if (stretcher.drag?.by !== pointer(e)) return;
      e.stopPropagation();
      stretcher.move(pointer(e), e.ray);
    },
    onPointerUp: (e) => {
      if (stretcher.drag?.by !== pointer(e)) return;
      e.stopPropagation();
      e.target?.releasePointerCapture?.(e.pointerId);
      stretcher.end(pointer(e));
      if (controls) controls.enabled = true;
    },
    onPointerCancel: (e) => {
      stretcher.end(pointer(e));
      if (controls) controls.enabled = true;
    },
    onClick: (e) => e.stopPropagation(), // (not on to the disc behind: that would select nothing)
    onPointerOver: (e) => {
      e.stopPropagation();
      if (!e.internalPointer) document.body.style.cursor = 'move';
    },
    onPointerOut: (e) => {
      if (!e.internalPointer && !stretcher.drag) document.body.style.cursor = '';
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
