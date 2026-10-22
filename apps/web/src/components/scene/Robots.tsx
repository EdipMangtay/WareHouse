import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STATUS_COLOR, useStore } from "../../state/store";
import { presentation, robotPose, robotElevation } from "../../simulation/presentation";
import { FLOOR_ELEV } from "./Mezzanine";
import type { RobotState } from "../../schema/twin_state";
import { HumanoidRobot, type HumanoidMotion } from "./HumanoidRobot";
import { useWarehouseOperations } from '../../state/warehouseOperations';

// Far fleet bodies share GPU resources. Seven color-pass meshes (eight with cargo),
// no body shadows; the original wrapper still supplies status ring and picking.
const proxyBox = new THREE.BoxGeometry(1, 1, 1);
const proxyLeg = (() => {
  const shin = new THREE.BoxGeometry(0.18, 0.73, 0.18).translate(0, -0.365, 0);
  const foot = new THREE.BoxGeometry(0.33, 0.13, 0.23).translate(0.065, -0.78, 0);
  const geometry = mergeGeometries([shin, foot]); shin.dispose(); foot.dispose(); return geometry;
})();
const proxyArm = new THREE.BoxGeometry(0.17, 0.63, 0.17).translate(0, -0.315, 0);
const proxyCeramic = new THREE.MeshStandardMaterial({ color: "#e7edf0", metalness: 0.25, roughness: 0.55 });
const proxyGraphite = new THREE.MeshStandardMaterial({ color: "#526676", metalness: 0.3, roughness: 0.65 });
const proxyVisor = new THREE.MeshBasicMaterial({ color: "#42e4ee", toneMapped: false });
const proxyCarton = new THREE.MeshStandardMaterial({ color: "#bd9061", roughness: 0.88 });

function DistantHumanoid({ r, motion }: { r: RobotState; motion: MutableRefObject<HumanoidMotion> }) {
  const arms = useRef<(THREE.Mesh | null)[]>([]), legs = useRef<(THREE.Mesh | null)[]>([]);
  const cargo = useRef<THREE.Mesh>(null!);
  const reduced = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { reduced.current = media.matches; }; change();
    media.addEventListener("change", change); return () => media.removeEventListener("change", change);
  }, []);
  const loaded = r.load.current > 0;
  const unavailable = r.status === "ERROR" || r.status === "OFFLINE" || r.status === "CHARGING";
  useFrame((_, delta) => {
    const visual = motion.current.robot ?? r;
    const loaded = visual.load.current > 0;
    const unavailable = visual.status === "ERROR" || visual.status === "OFFLINE" || visual.status === "CHARGING";
    if (cargo.current) cargo.current.visible = loaded && !visual.payload_package_id;
    if (motion.current.paused) return;
    // Same travelled distance as the detailed body; zero progress when stopped.
    const stride = motion.current.moving && !unavailable && !reduced.current ? Math.sin(motion.current.distance * Math.PI * 2 / 1.25) * 0.25 : 0;
    const blend = 1 - Math.exp(-delta * 12);
    for (let i = 0; i < 2; i++) {
      const swing = i ? -stride : stride, leg = legs.current[i], arm = arms.current[i];
      if (leg) leg.rotation.z += (swing - leg.rotation.z) * blend;
      if (arm) arm.rotation.z += ((loaded ? 0.72 : -swing) - arm.rotation.z) * blend;
    }
  });
  return <group dispose={null}>
    <mesh geometry={proxyBox} material={proxyCeramic} position={[0, 1.34, 0]} scale={[0.35, 0.64, 0.55]} />
    <mesh geometry={proxyBox} material={proxyCeramic} position={[0, 1.89, 0]} scale={[0.29, 0.3, 0.29]} rotation-z={unavailable ? -0.12 : 0} />
    <mesh geometry={proxyBox} material={proxyVisor} position={[0.151, 1.91, 0]} scale={[0.015, 0.085, 0.24]} />
    {[-1, 1].map((side, i) => <group key={side}>
      <mesh ref={node => { legs.current[i] = node; }} geometry={proxyLeg} material={proxyGraphite} position={[0, 0.88, side * 0.155]} />
      <mesh ref={node => { arms.current[i] = node; }} geometry={proxyArm} material={proxyCeramic} position={[0, 1.54, side * 0.335]} rotation-z={loaded ? 0.72 : 0} />
    </group>)}
    <mesh ref={cargo} visible={loaded && !r.payload_package_id} geometry={proxyBox} material={proxyCarton} position={[0.47, 1.36, 0]} scale={[0.46, 0.39, 0.56]} />
  </group>;
}

/** Humanoid fleet wrapper preserves authoritative position, lift tracking and selection. */
export function RobotMesh({ r, selected, onSelect, showLabel, lite, smooth = true }: { r: RobotState; selected: boolean; onSelect: () => void; showLabel: boolean; lite?: boolean; smooth?: boolean }) {
  const showStatus = useStore(s=>s.layers.status);
  const hovered = useStore(s=>s.hovered?.kind === "robot" && s.hovered.id === r.id);
  const color = STATUS_COLOR[r.status];
  const camera = useThree(state => state.camera);
  const [lod, setLod] = useState(() => {
    const distance = camera.position.distanceToSquared(new THREE.Vector3(r.position[0], (FLOOR_ELEV[r.floor] ?? 0) + 1, r.position[2]));
    return { detailed: selected || !smooth || distance < 45 * 45, label: selected || distance < 35 * 35 };
  });
  const lodRef = useRef(lod);
  const lodTimer = useRef(0);
  const worldCenter = useMemo(() => new THREE.Vector3(), []);
  const ringRef = useRef<THREE.Mesh>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const motion = useRef<HumanoidMotion>({ distance: 0, moving: false, paused: false });
  // ⚠ round-9 真因修正：transform 只能給「掛載當下」的初始值（穩定參照）。
  // 若直接寫 position={[r.position[0], FLOOR_ELEV[r.floor], ...]}，props 內容每個 tick 都變，
  // React 每次 re-render（10 Hz）都會把 useFrame 平滑後的 transform 覆寫回「原始座標 + FLOOR_ELEV(floor)」。
  // 搭電梯時 floor 與實際高度不同（floor 到出電梯才翻），於是每 100 ms 被彈到錯誤高度再被 useFrame 拉回
  // —— 這就是電梯上下與出門時鋸齒狀晃動的來源。初始高度也要 lift-aware（重新掛載時不從錯誤樓層彈出）。
  const init = useRef<{ p: [number, number, number]; h: number } | null>(null);
  if (!init.current) {
    const L0 = r.lift_id ? useStore.getState().twin.lifts[r.lift_id] : null;
    init.current = { p: [r.position[0], L0 ? L0.y : FLOOR_ELEV[r.floor] ?? 0, r.position[2]], h: -r.heading };
  }
  // All translation uses the bounded snapshot timeline; transforms have one owner.
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (g) {
      const previousX = g.position.x, previousZ = g.position.z;
      const frame = smooth ? presentation.sample() : null;
      const pose = robotPose(frame, r);
      g.position.x = pose.position[0];
      g.position.z = pose.position[2];
      motion.current.actionProgress = pose.progress;
      motion.current.robot = pose.robot;
      const st = useStore.getState();
      g.position.y = robotElevation(frame, pose.robot, FLOOR_ELEV, !lite && st.activeFloor === "exploded");
      g.rotation.y = -pose.heading;
      const displacement = Math.hypot(g.position.x - previousX, g.position.z - previousZ);
      motion.current.paused = st.twin.sim.mode === "PAUSED" || st.twin.sim.speed === 0;
      motion.current.moving = displacement > 0.00001 && displacement < 2 && !motion.current.paused;
      if (motion.current.moving) motion.current.distance += displacement;
      lodTimer.current += dt;
      if (lodTimer.current >= 0.3) {
        lodTimer.current = 0;
        g.getWorldPosition(worldCenter); worldCenter.y += 1;
        const distance = camera.position.distanceToSquared(worldCenter);
        const detailed = selected || !smooth || distance < (lodRef.current.detailed ? 48 * 48 : 42 * 42);
        const label = selected || distance < (lodRef.current.label ? 37 * 37 : 33 * 33);
        if (detailed !== lodRef.current.detailed || label !== lodRef.current.label) {
          lodRef.current = { detailed, label }; setLod(lodRef.current);
        }
      }
    }
    if (ringRef.current) ringRef.current.scale.setScalar(selected ? 1.03 : 1);

  });
  return (
    <group ref={groupRef} position={init.current.p} rotation-y={init.current.h}>
      <group onClick={(e) => { e.stopPropagation(); if(useStore.getState().tool === "select")onSelect(); }} onPointerOver={(e) => {e.stopPropagation();useStore.getState().hover({kind:"robot",id:r.id});}} onPointerOut={() => useStore.getState().hover(null)}>
        {lod.detailed || selected || !smooth ? <HumanoidRobot r={r} motion={motion} lite={lite} preview={!smooth} /> : <DistantHumanoid r={r} motion={motion} />}
      </group>
      {/* Phase 7：虛擬 LiDAR 視覺化（選取時畫 270° 扇形 + 到各障礙的射線；任何機器人因感知停車時畫前方紅弧） */}
      {!lite && selected && <PerceptionGizmo r={r} />}
      {showStatus && !lite && !selected && r.perception?.state === "STOPPED" && (
        <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.95, 1.12, 24, 1, -Math.PI / 6, Math.PI / 3]} /><meshBasicMaterial color="#ef4444" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
      )}
      {/* 地面光環 */}
      <mesh visible={showStatus || selected || hovered} ref={ringRef} position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.58, 0.74, 40]} />
        <meshBasicMaterial color={selected ? "#a3e7f5" : hovered ? "#edce8f" : color} transparent opacity={selected ? 0.9 : 0.45} side={THREE.DoubleSide} />
      </mesh>
      {selected && <mesh position={[0, 0.015, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[1.1, 40]} /><meshBasicMaterial color="#3b82f6" transparent opacity={0.18} /></mesh>}
      {showStatus && !lite && (r.status === "ERROR") && <pointLight position={[0, 1.6, 0]} color="#ef4444" intensity={4} distance={5} />}
      {showLabel && (selected || lod.label) && (
        <Html position={[0, 2.35, 0]} zIndexRange={[10, 0]}>
          <div className={"lbl" + (selected ? " sel" : r.status === "ERROR" ? " err" : r.status === "CHARGING" ? " chg" : "")} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
            {r.status === "ERROR" ? "⚠ " : ""}{r.id}
          </div>
        </Html>
      )}
    </group>
  );
}

const PERC_COLOR = { CLEAR: "#22d3ee", SLOWING: "#f59e0b", STOPPED: "#ef4444", OFF: "#475569" } as const;
/** 選取機器人的感知層：270° / 4 m 扇形（顏色 = 感知狀態）、正前方淨空線、到每個障礙的射線（紅 = 擋路的動態障礙） */
function PerceptionGizmo({ r }: { r: RobotState }) {
  const P = r.perception; if (!P) return null;
  const col = PERC_COLOR[P.state];
  const range = 4;
  return (
    <group>
      <mesh position={[0, 0.025, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.7, range, 48, 1, -Math.PI * 0.75, Math.PI * 1.5]} />
        <meshBasicMaterial color={col} transparent opacity={P.state === "STOPPED" ? 0.16 : 0.09} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[range - 0.05, range, 48, 1, -Math.PI * 0.75, Math.PI * 1.5]} />
        <meshBasicMaterial color={col} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[0.7, 0.08, 0], [Math.max(0.7, P.ahead_m), 0.08, 0]]} color={col} lineWidth={2} transparent opacity={0.9} />
      {P.obstacles.map((o, i) => {
        const b = (-o.bearing_deg * Math.PI) / 180; const x = o.distance_m * Math.cos(b), z = o.distance_m * Math.sin(b);
        const blocking = o.kind !== "RACK" && P.state !== "CLEAR" && o.distance_m <= P.ahead_m + 0.05;
        const c = o.kind === "RACK" ? "#94a3b8" : blocking ? "#ef4444" : o.kind === "HUMAN" ? "#f97316" : "#fbbf24";
        return (
          <group key={i}>
            <Line points={[[0, 0.1, 0], [x, 0.1, z]]} color={c} lineWidth={blocking ? 2 : 1} dashed={o.kind === "RACK"} dashSize={0.3} gapSize={0.2} transparent opacity={0.85} />
            {o.kind !== "RACK" && <mesh position={[x, 0.1, z]}><sphereGeometry args={[0.12, 8, 8]} /><meshBasicMaterial color={c} /></mesh>}
          </group>
        );
      })}
    </group>
  );
}

/** 機器人目前的 A* 路徑（格點 → 世界座標），選取時加粗；終點畫圓環 */
function RobotPath({ r, selected }: { r: RobotState; selected: boolean }) {
  const pts = useMemo(() => {
    if (r.path.length === 0 || r.path_index >= r.path.length) return null;
    const y = (FLOOR_ELEV[r.floor] ?? 0) + (useStore.getState().activeFloor === "exploded" && r.floor === 2 ? 5 : 0) + 0.06;
    const out: [number, number, number][] = [[r.position[0], y, r.position[2]]];
    for (let i = r.path_index; i < r.path.length; i++) out.push([r.path[i][0] + 0.5, y, r.path[i][1] + 0.5]);
    return out;
  }, [r.path, r.path_index, r.position, r.floor]);
  if (!pts) return null;
  const end = pts[pts.length - 1];
  const col = r.fsm === "GOING_TO_CHARGE" ? "#60a5fa" : r.load.current > 0 ? "#f59e0b" : "#22d3ee";
  return (
    <group>
      <Line points={pts} color={selected ? "#ffffff" : col} lineWidth={selected ? 2.4 : 1.1} dashed dashSize={0.7} gapSize={0.4} transparent opacity={selected ? 1 : 0.5} />
      <mesh position={[end[0], end[1] - 0.01, end[2]]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.45, 0.65, 24]} /><meshBasicMaterial color={col} transparent opacity={0.85} /></mesh>
    </group>
  );
}

export function Robots({ lite = false }: { lite?: boolean }) {
  const robots = useStore((s) => s.twin.robots);
  const selected = useStore((s) => s.selectedRobot);
  const selection = useStore(s => s.selection);
  const orders = useWarehouseOperations(s => s.data?.orders);
  const order = selection?.kind === 'order' ? orders?.find(o => o.id === selection.id) : null;
  const related = (r: RobotState) => r.id === selected || !!order && !!r.current_task_id && order.task_ids.includes(r.current_task_id);
  const select = useStore((s) => s.select);
  const showLabels = useStore((s) => s.showLabels);
  const showPaths = useStore((s) => s.showPaths);
  const af = useStore((s) => s.activeFloor);
  const activeFloor = lite || af === "exploded" ? "all" : af;
  const visible = (r: RobotState) => activeFloor === "all" || r.floor === activeFloor || !!r.lift_id;
  return (
    <group>
      {Object.values(robots).filter(visible).map((r) => (
        <group key={r.id}>
          <RobotMesh r={r} selected={related(r)} onSelect={() => select(r.id)} showLabel={showLabels && !lite} lite={lite} />
          {showPaths && !lite && <RobotPath r={r} selected={related(r)} />}
        </group>
      ))}
    </group>
  );
}
