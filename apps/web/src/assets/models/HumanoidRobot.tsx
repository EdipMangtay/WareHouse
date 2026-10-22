import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {armorGeometry, boxGeometry, jointGeometry, ceramic, graphite, alloy, rubber, orange, visor, carton, tape, parcelLabel} from "../materials/humanoid";
import type { RobotState } from "../../schema/twin_state";



type Triple = [number, number, number];
export type HumanoidMotion = { distance: number; moving: boolean; paused: boolean; actionProgress?: number; robot?: Pick<RobotState, "status" | "fsm" | "load" | "payload_package_id"> };
function Part({ position, scale, material = ceramic, rounded = true, shadow = true }: { position: Triple; scale: Triple; material?: THREE.Material; rounded?: boolean; shadow?: boolean }) {
  return <mesh position={position} scale={scale} geometry={rounded ? armorGeometry : boxGeometry} material={material} castShadow={shadow} receiveShadow={shadow} dispose={null} />;
}
function Joint({ position, radius = 0.085, lite = false }: { position: Triple; radius?: number; lite?: boolean }) {
  return <mesh position={position} scale={[radius, radius, radius]} geometry={jointGeometry} material={graphite} castShadow={!lite} dispose={null} />;
}

/** 2.04m industrial biped. Local forward is +X, matching the fleet's heading convention. */
export function HumanoidRobot({ r, motion, lite = false, preview = false, simulationTimeS, phaseStartedS }: { r: Pick<RobotState, "status" | "fsm" | "load" | "payload_package_id">; motion: MutableRefObject<HumanoidMotion>; lite?: boolean; preview?: boolean; simulationTimeS: number; phaseStartedS: number }) {
  const pelvis = useRef<THREE.Group>(null!);
  const torso = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const hips = useRef<(THREE.Group | null)[]>([]);
  const knees = useRef<(THREE.Group | null)[]>([]);
  const ankles = useRef<(THREE.Group | null)[]>([]);
  const shoulders = useRef<(THREE.Group | null)[]>([]);
  const elbows = useRef<(THREE.Group | null)[]>([]);
  const lamp = useRef<THREE.MeshStandardMaterial>(null!);
  const reducedMotion = useRef(false);
  const phase = useRef(0);
  const previousDistance = useRef(motion.current.distance);
  const wasPaused = useRef(false);
  const initialized = useRef(false);
  const cargo = useRef<THREE.Group>(null!);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotion.current = media.matches; };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useFrame((_, delta) => {
    const data = motion.current;
    const visual = data.robot ?? r;
    if (cargo.current) cargo.current.visible = visual.load.current > 0 && !visual.payload_package_id;

    // Do not derive steps from wall time: stationary/paused robots cannot walk in place.
    const travelled = Math.max(0, data.distance - previousDistance.current);
    previousDistance.current = data.distance;
    const paused = data.paused && !preview;
    if (paused && initialized.current) { wasPaused.current = true; return; }
    const failed = visual.status === "ERROR" || visual.status === "OFFLINE";
    const charging = visual.status === "CHARGING";
    const carrying = visual.load.current > 0;
    const walking = data.moving && !paused && !failed && !charging && !preview && !reducedMotion.current;
    if (walking && !wasPaused.current) phase.current += travelled * (Math.PI * 2 / 1.25);
    wasPaused.current = false;
    const stride = walking ? Math.sin(phase.current) : 0;
    const action = visual.fsm === "PICKING" || visual.fsm === "DELIVERING";
    const actionSeconds = Math.max(0, simulationTimeS - phaseStartedS);
    // A single bend/reach per task dwell, then hold. No unrelated random gestures.
    const bend = action ? (reducedMotion.current ? 0.18 : Math.sin(Math.min(1, data.actionProgress ?? actionSeconds / 2.2) * Math.PI) * 0.38 + 0.08) : failed ? 0.19 : charging ? 0.08 : 0;
    const blend = !initialized.current || preview ? 1 : 1 - Math.exp(-delta * 12);
    const ease = (current: number, target: number) => current + (target - current) * blend;
    // Lower the pelvis by the support leg shortening, keeping its sole near the floor.
    const supportDrop = walking ? 0.785 * (1 - Math.cos(stride * 0.42)) : 0;
    pelvis.current.position.y = ease(pelvis.current.position.y, 0.96 - supportDrop - bend * 0.13);
    pelvis.current.rotation.y = ease(pelvis.current.rotation.y, stride * 0.06);
    torso.current.rotation.y = ease(torso.current.rotation.y, -stride * 0.13);
    torso.current.rotation.z = ease(torso.current.rotation.z, -bend - (walking ? 0.035 : 0));
    head.current.rotation.z = ease(head.current.rotation.z, failed ? -0.22 : charging ? -0.12 : bend * 0.35);
    for (let i = 0; i < 2; i++) {
      const swing = i === 0 ? stride : -stride;
      const hip = hips.current[i], knee = knees.current[i], ankle = ankles.current[i], shoulder = shoulders.current[i], elbow = elbows.current[i];
      const hipAngle = swing * 0.42 + bend * 0.34;
      const forwardSwing = walking ? Math.max(0, Math.cos(phase.current + i * Math.PI)) : 0;
      const kneeAngle = -forwardSwing * 0.68 - bend * 0.6;
      if (hip) hip.rotation.z = ease(hip.rotation.z, hipAngle);
      if (knee) knee.rotation.z = ease(knee.rotation.z, kneeAngle);
      if (ankle) ankle.rotation.z = ease(ankle.rotation.z, -hipAngle - kneeAngle);
      if (shoulder) shoulder.rotation.z = ease(shoulder.rotation.z, carrying ? 0.48 : action ? 0.55 + bend : failed ? 0.12 : charging ? 0.18 : -swing * 0.34);
      if (elbow) elbow.rotation.z = ease(elbow.rotation.z, carrying ? 1.24 : action ? 0.92 : charging ? 0.25 : 0.15 + Math.max(0, -swing) * 0.2);
    }
    if (lamp.current) lamp.current.emissiveIntensity = failed ? 0.65 : charging ? 0.85 : 1.25;
    initialized.current = true;
  });

  const statusColor = r.status === "ERROR" ? "#ff654f" : r.status === "OFFLINE" ? "#677480" : r.status === "CHARGING" ? "#6be1a4" : r.status === "WARNING" ? "#ffb74e" : "#42e4ee";
  return <group dispose={null}>
    <group ref={pelvis} position={[0, 0.96, 0]}>
      <Part position={[0, 0.025, 0]} scale={[0.29, 0.22, 0.43]} material={graphite} shadow={!lite} />
      <Part position={[0.09, 0.08, 0]} scale={[0.19, 0.15, 0.35]} shadow={!lite} />
      {!lite && <Part position={[0.196, 0.085, 0]} scale={[0.012, 0.06, 0.14]} material={orange} />}
      {[-1, 1].map((side, index) => <group key={side} ref={node => { hips.current[index] = node; }} position={[0, -0.025, side * 0.155]}>
        <Joint position={[0, 0, 0]} radius={0.106} lite={lite} />
        <Part position={[0, -0.205, 0]} scale={[0.225, 0.34, 0.19]} shadow={!lite} />
        {!lite && <Part position={[-0.105, -0.20, 0]} scale={[0.045, 0.25, 0.095]} material={alloy} />}
        <group ref={node => { knees.current[index] = node; }} position={[0, -0.40, 0]}>
          <Joint position={[0, 0, 0]} radius={0.087} lite={lite} />
          <Part position={[0.075, 0, 0]} scale={[0.13, 0.15, 0.18]} material={graphite} shadow={!lite} />
          <Part position={[0, -0.19, 0]} scale={[0.18, 0.33, 0.17]} shadow={!lite} />
          {!lite && <Part position={[0.094, -0.21, 0]} scale={[0.015, 0.18, 0.065]} material={orange} />}
          <group ref={node => { ankles.current[index] = node; }} position={[0, -0.385, 0]}>
            <Joint position={[0, 0, 0]} radius={0.064} lite={lite} />
            <Part position={[0.065, -0.055, 0]} scale={[0.34, 0.115, 0.21]} material={graphite} shadow={!lite} />
            <Part position={[0.055, -0.105, 0]} scale={[0.35, 0.035, 0.225]} material={rubber} shadow={!lite} />
            {!lite && <Part position={[0.14, -0.037, 0]} scale={[0.16, 0.05, 0.185]} />}
          </group>
        </group>
      </group>)}
      <group ref={torso} position={[0, 0.14, 0]}>
        <Part position={[-0.025, 0.15, 0]} scale={[0.235, 0.30, 0.31]} material={graphite} shadow={!lite} />
        <Part position={[0.055, 0.12, 0]} scale={[0.26, 0.12, 0.32]} shadow={!lite} />
        <Part position={[0.045, 0.28, 0]} scale={[0.32, 0.23, 0.49]} shadow={!lite} />
        <Part position={[0.018, 0.42, 0]} scale={[0.32, 0.16, 0.55]} shadow={!lite} />
        <Part position={[0.19, 0.37, 0]} scale={[0.025, 0.14, 0.33]} material={graphite} shadow={!lite} />
        <mesh position={[0.21, 0.39, 0]} scale={[0.018, 0.024, 0.22]} geometry={boxGeometry}>
          <meshStandardMaterial ref={lamp} color={statusColor} emissive={statusColor} emissiveIntensity={1.25} roughness={0.2} />
        </mesh>
        {!lite && <>
          <Part position={[-0.19, 0.29, 0]} scale={[0.14, 0.33, 0.30]} material={graphite} />
          <Part position={[-0.27, 0.30, 0]} scale={[0.025, 0.21, 0.16]} material={alloy} />
          {[-0.09, 0, 0.09].map(y => <Part key={y} position={[-0.29, 0.30 + y, 0]} scale={[0.014, 0.015, 0.22]} material={rubber} rounded={false} />)}
          <Part position={[0.224, 0.305, 0.09]} scale={[0.014, 0.03, 0.055]} material={orange} />
        </>}
        <Joint position={[0, 0.55, 0]} radius={0.09} lite={lite} />
        <group ref={head} position={[0, 0.79, 0]}>
          <Part position={[0, 0, 0]} scale={[0.29, 0.30, 0.29]} shadow={!lite} />
          <Part position={[0.145, 0.01, 0]} scale={[0.07, 0.17, 0.265]} material={graphite} shadow={!lite} />
          <Part position={[0.184, 0.017, 0]} scale={[0.025, 0.06, 0.215]} material={visor} shadow={false} />
          {!lite && <>
            <Part position={[0.148, -0.091, 0]} scale={[0.025, 0.034, 0.13]} material={alloy} />
            {[-1, 1].map(side => <Part key={side} position={[-0.018, 0.008, side * 0.154]} scale={[0.12, 0.13, 0.034]} material={graphite} />)}
          </>}
        </group>
        {[-1, 1].map((side, index) => <group key={side} ref={node => { shoulders.current[index] = node; }} position={[0, 0.44, side * 0.335]}>
          <Joint position={[0, 0, 0]} radius={0.1} lite={lite} />
          <Part position={[0, -0.05, side * 0.03]} scale={[0.235, 0.20, 0.20]} shadow={!lite} />
          {!lite && <Part position={[0.015, -0.045, side * 0.134]} scale={[0.11, 0.085, 0.022]} material={orange} />}
          <Part position={[0, -0.19, 0]} scale={[0.155, 0.22, 0.15]} shadow={!lite} />
          <group ref={node => { elbows.current[index] = node; }} position={[0, -0.31, 0]}>
            <Joint position={[0, 0, 0]} radius={0.071} lite={lite} />
            <Part position={[0, -0.14, 0]} scale={[0.17, 0.23, 0.155]} shadow={!lite} />
            {!lite && <Part position={[0.09, -0.14, 0]} scale={[0.015, 0.13, 0.065]} material={graphite} />}
            <Joint position={[0, -0.285, 0]} radius={0.055} lite={lite} />
            <Part position={[0.015, -0.33, 0]} scale={[0.12, 0.11, 0.125]} material={graphite} shadow={!lite} />
            {!lite && [-0.038, 0.038].map(z => <Part key={z} position={[0.042, -0.391, z]} scale={[0.045, 0.065, 0.04]} material={alloy} />)}
          </group>
        </group>)}
        <group ref={cargo} visible={r.load.current > 0 && !r.payload_package_id} position={[0.47, 0.26, 0]}>
          <Part position={[0, 0, 0]} scale={[0.46, 0.39, 0.56]} material={carton} shadow={!lite} />
          <Part position={[0, 0.199, 0]} scale={[0.46, 0.01, 0.065]} material={tape} rounded={false} shadow={false} />
          <Part position={[0.234, 0.017, 0]} scale={[0.01, 0.15, 0.22]} material={parcelLabel} rounded={false} shadow={false} />
          {!lite && [-0.06, -0.03, 0.005, 0.043, 0.062].map(z => <Part key={z} position={[0.241, 0.017, z]} scale={[0.005, 0.07, 0.009]} material={graphite} rounded={false} shadow={false} />)}
        </group>
      </group>
    </group>
  </group>;
}
