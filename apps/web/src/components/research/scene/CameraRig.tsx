import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { ResearchSnapshot } from '../../../../../../packages/contracts/research';
import { useResearch } from '../../../state/research';
import { focusPoint, safeCameraPosition, type Point } from './layout';
export function CameraRig({ state, reduced }: { state: ResearchSnapshot; reduced: boolean }) {
    const controls = useRef<OrbitImpl>(null!), request = useResearch(s => s.camera), racks = useResearch(s => s.layers.racks);
    const { camera, size } = useThree();
    const transition = useRef(false), dragging = useRef(false), following = useRef(false);
    const goal = useRef(new THREE.Vector3()), target = useRef(new THREE.Vector3());
    const offset = useRef(new THREE.Vector3());
    useEffect(() => {
        const point = focusPoint(request.target, state), aspect = size.width / Math.max(1, size.height);
        const span = state.config.belt_length_m + 28, fit = Math.max(1, 1.55 / aspect);
        target.current.set(...point);
        if (request.mode === 'overview') offset.current.set(span * .08 * fit, span * .66 * fit, span * .67 * fit);
        else if (request.mode === 'top') offset.current.set(0, span * .78 * fit, .01);
        else if (request.target?.kind === 'belt' || request.target?.kind === 'order') offset.current.set(4, span * .43 * fit, span * .4 * fit);
        else offset.current.set(5, request.target?.kind === 'zone' ? 14 : 10, request.target?.kind === 'zone' ? 14 : 11);
        goal.current.copy(target.current).add(offset.current);
        transition.current = true; dragging.current = false; following.current = request.mode === 'follow';
        // Requests and viewport changes move the camera. Simulation ticks alone never reset orbit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request.revision, size.width, size.height]);
    useFrame((_, dt) => {
        const orbit = controls.current; if (!orbit) return;
        if (following.current && !dragging.current) { target.current.set(...focusPoint(request.target, state)); goal.current.copy(target.current).add(offset.current); transition.current = true; }
        if (transition.current && !dragging.current) {
            const k = reduced ? 1 : 1 - Math.exp(-Math.min(dt, .1) * 6);
            camera.position.lerp(goal.current, k); orbit.target.lerp(target.current, k);
            if (camera.position.distanceTo(goal.current) < .03 && !following.current) transition.current = false;
        }
        camera.position.set(...safeCameraPosition(camera.position.toArray() as Point, state, racks));
        orbit.target.y = Math.max(0, orbit.target.y);
        orbit.target.x = THREE.MathUtils.clamp(orbit.target.x, -6, state.config.belt_length_m + 23);
        orbit.target.z = THREE.MathUtils.clamp(orbit.target.z, -40, 12);
        orbit.update();
    });
    return <OrbitControls ref={controls} makeDefault minDistance={5} maxDistance={Math.max(180, state.config.belt_length_m * 4)} maxPolarAngle={Math.PI / 2 - .09} minPolarAngle={.0001} enableDamping={!reduced} dampingFactor={.12} zoomSpeed={.8} rotateSpeed={.55} panSpeed={.7} onStart={() => { dragging.current = true; transition.current = false; following.current = false; }} onEnd={() => { dragging.current = false; }}/>
}
