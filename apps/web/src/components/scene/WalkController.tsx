import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { layout, useStore } from '../../state/store';
import { buildNavGrid } from '../../layout/navgrid';
import { clearWalkInput, EYE_HEIGHT, moveWalkPoint, nearestWalkPoint, walkDisplacement, walkInput } from './walking';

export function requestWalkCapture() {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-walk-surface]');
  if (!canvas) return;
  canvas.focus({ preventScroll: true });
  if (!canvas.requestPointerLock) {
    useStore.getState().setNotice('Bakmak için sahneyi sürükleyebilirsiniz.', 'info');
    return;
  }
  try {
    const request = canvas.requestPointerLock();
    request?.catch(() => useStore.getState().setNotice('Fare yakalanamadı. Bakmak için sahneyi sürükleyin.', 'info'));
  } catch { useStore.getState().setNotice('Bakmak için sahneyi sürükleyebilirsiniz.', 'info'); }
}

/** Human camera uses navigation geometry but never changes robots, tasks or routes. */
export function WalkController({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, gl } = useThree();
  const mode = useStore(s => s.cameraMode), target = useStore(s => s.walkTarget);
  const grid = useMemo(() => buildNavGrid(layout, 1), []);
  const keys = useRef(new Set<string>()), yaw = useRef(Math.PI), pitch = useRef(0);
  const elapsed = useRef(0), direction = useMemo(() => new THREE.Vector3(), []);
  const settings = useStore(s => s.cameraSettings);

  useEffect(() => {
    if (mode !== 'walk' || !(camera instanceof THREE.PerspectiveCamera)) return;
    const previous = useStore.getState().walkPose;
    const point = nearestWalkPoint(grid, target ?? (previous ? [previous.x, previous.z] : [layout.size.width / 2, 14.5]));
    if (!point) {
      useStore.getState().setCameraMode('orbit');
      useStore.getState().setNotice('Bu katta dolaşıma uygun bir koridor bulunamadı.');
      return;
    }
    camera.position.set(point[0], EYE_HEIGHT, point[1]);
    yaw.current = target ? Math.atan2(layout.size.width / 2 - point[0], point[1] - layout.size.depth / 2) : previous?.yaw ?? Math.PI;
    pitch.current = 0;
    keys.current.clear(); clearWalkInput();
    useStore.getState().setWalkPose({ x: point[0], z: point[1], yaw: yaw.current });
    gl.domElement.focus({ preventScroll: true });
  }, [mode, target, camera, gl, grid]);

  useEffect(() => {
    if (mode !== 'walk') return;
    const canvas = gl.domElement;
    const keySet = keys.current;
    const moveKeys = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','ShiftLeft','ShiftRight','ControlLeft','ControlRight']);
    let dragging: number | null = null, lastX = 0, lastY = 0;
    const clear = () => { keySet.clear(); clearWalkInput(); dragging = null; };
    const ownsFocus = () => document.activeElement === canvas || document.pointerLockElement === canvas;
    const down = (event: KeyboardEvent) => {
      const state = useStore.getState();
      if (!ownsFocus() || state.modal || state.drawer || event.metaKey || event.altKey) return;
      if (moveKeys.has(event.code)) { event.preventDefault(); keySet.add(event.code); }
    };
    const up = (event: KeyboardEvent) => { keySet.delete(event.code); };
    const turn = (dx: number, dy: number) => {
      const sensitivity = useStore.getState().cameraSettings.sensitivity * .0022;
      yaw.current += dx * sensitivity;
      yaw.current = Math.atan2(Math.sin(yaw.current), Math.cos(yaw.current));
      pitch.current = THREE.MathUtils.clamp(pitch.current - dy * sensitivity, -1.25, 1.25);
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || document.pointerLockElement === canvas) return;
      canvas.focus({ preventScroll: true });
      dragging = event.pointerId; lastX = event.clientX; lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (dragging !== event.pointerId || document.pointerLockElement === canvas) return;
      turn(event.clientX - lastX, event.clientY - lastY); lastX = event.clientX; lastY = event.clientY;
    };
    const pointerUp = () => { dragging = null; };
    const mouseMove = (event: MouseEvent) => { if (document.pointerLockElement === canvas) turn(event.movementX, event.movementY); };
    const lockChange = () => { clear(); useStore.getState().setWalkCaptured(document.pointerLockElement === canvas); };
    const lockError = () => useStore.getState().setNotice('Fare yakalanamadı. Sürükleyerek bakış kontrolü kullanılabilir.', 'info');
    const stopClick = (event: MouseEvent) => event.stopImmediatePropagation();
    const blurCanvas = () => { if (document.pointerLockElement !== canvas) clear(); };
    canvas.dataset.walkSurface = 'true';
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('lostpointercapture', pointerUp);
    canvas.addEventListener('dblclick', requestWalkCapture);
    canvas.addEventListener('click', stopClick, true);
    canvas.addEventListener('blur', blurCanvas);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('pointerlockchange', lockChange);
    document.addEventListener('pointerlockerror', lockError);
    return () => {
      clear(); delete canvas.dataset.walkSurface;
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('lostpointercapture', pointerUp);
      canvas.removeEventListener('dblclick', requestWalkCapture);
      canvas.removeEventListener('click', stopClick, true);
      canvas.removeEventListener('blur', blurCanvas);
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear); document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('pointerlockchange', lockChange); document.removeEventListener('pointerlockerror', lockError);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      useStore.getState().setWalkCaptured(false);
      controls.current?.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(6));
    };
  }, [mode, gl, camera, controls]);

  useEffect(() => {
    if (mode === 'walk' && camera instanceof THREE.PerspectiveCamera) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  }, [camera, mode, settings.fov]);

  useFrame((_, dt) => {
    if (mode !== 'walk' || !(camera instanceof THREE.PerspectiveCamera)) return;
    const state = useStore.getState(), k = keys.current, held = walkInput.held;
    if (state.modal || state.drawer || document.hidden) { k.clear(); clearWalkInput(); return; }
    const down = (...codes: string[]) => codes.some(code => k.has(code));
    const forward = Number(down('KeyW','ArrowUp') || held.has('forward')) - Number(down('KeyS','ArrowDown') || held.has('back'));
    const right = Number(down('KeyD','ArrowRight') || held.has('right')) - Number(down('KeyA','ArrowLeft') || held.has('left'));
    const step = Math.min(dt, .06);
    yaw.current += (Number(down('KeyE') || held.has('turnRight')) - Number(down('KeyQ') || held.has('turnLeft'))) * step * 1.4;
    const speed = state.cameraSettings.walkSpeed * (down('ShiftLeft','ShiftRight') ? 2 : down('ControlLeft','ControlRight') ? .35 : 1);
    const next = moveWalkPoint(grid, [camera.position.x, camera.position.z], walkDisplacement(forward, right, yaw.current, speed * step));
    camera.position.set(next[0], EYE_HEIGHT, next[1]);
    direction.set(Math.sin(yaw.current) * Math.cos(pitch.current), Math.sin(pitch.current), -Math.cos(yaw.current) * Math.cos(pitch.current));
    camera.lookAt(direction.add(camera.position));
    elapsed.current += dt;
    if (elapsed.current >= .1) { elapsed.current = 0; state.setWalkPose({ x: next[0], z: next[1], yaw: yaw.current }); }
  });
  return null;
}
