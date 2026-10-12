import { ConveyorParcels } from "./ConveyorParcels";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { layout, useStore } from "../../state/store";
import type { LayoutConveyor, P2, Rect } from "../../layout/types";

type Part = { at: [number, number, number]; size: [number, number, number]; yaw?: number };
/** One geometry and one material/draw call for each family of repeated fixture parts. */
function Parts({ parts, color, metalness = 0.4, emissive = false, map }: { parts: Part[]; color: string; metalness?: number; emissive?: boolean; map?:THREE.Texture }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const object = new THREE.Object3D();
    parts.forEach((part, index) => {
      object.position.set(...part.at); object.scale.set(...part.size); object.rotation.set(0, part.yaw ?? 0, 0);
      object.updateMatrix(); ref.current.setMatrixAt(index, object.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere();
  }, [parts]);
  if (!parts.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow={!emissive} receiveShadow={!emissive}>
    <boxGeometry args={[1, 1, 1]} />{emissive ? <meshBasicMaterial color={color} /> : <meshStandardMaterial map={map} color={color} roughness={0.67} metalness={metalness} />}
  </instancedMesh>;
}

function NearbyLabel({ position, text, color = "#a7c2cd" }: { position: [number, number, number]; text: string; color?: string }) {
  const label = useRef<HTMLDivElement>(null);
  const showLabels = useStore(state => state.showLabels);
  const world = useMemo(() => new THREE.Vector3(...position), [position[0], position[1], position[2]]);
  const frames = useRef(0);
  useFrame(({ camera }) => {
    if (!label.current || ++frames.current % 12 !== 0) return;
    label.current.style.display = camera.position.distanceToSquared(world) < 42 * 42 ? "block" : "none";
  });
  if (!showLabels) return null;
  return <Html position={position} center zIndexRange={[2, 0]} style={{ pointerEvents: "none" }}><div ref={label} style={{ display: "none", color, border: "1px solid #58757e88", background: "#172932dd", borderRadius: 3, padding: "3px 7px", fontSize: 9, fontFamily: "ui-monospace,monospace", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{text}</div></Html>;
}

function FloorArea({ rect, color, opacity = 0.12, slots = 0 }: { rect: Rect; color: string; opacity?: number; slots?: number }) {
  const [x0, z0, x1, z1] = rect;
  const outline = useMemo(() => {
    const lines: THREE.Vector3[] = [];
    const line = (ax: number, az: number, bx: number, bz: number) => lines.push(new THREE.Vector3(ax, 0.018, az), new THREE.Vector3(bx, 0.018, bz));
    line(x0, z0, x1, z0); line(x1, z0, x1, z1); line(x1, z1, x0, z1); line(x0, z1, x0, z0);
    for (let i = 1; i < slots; i++) { const x = x0 + (x1 - x0) * i / slots; line(x, z0, x, z1); }
    return new THREE.BufferGeometry().setFromPoints(lines);
  }, [x0, z0, x1, z1, slots]);
  useEffect(() => () => outline.dispose(), [outline]);
  return <group>
    <mesh position={[(x0 + x1) / 2, 0.009, (z0 + z1) / 2]} rotation-x={-Math.PI / 2}><planeGeometry args={[x1 - x0, z1 - z0]} /><meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} /></mesh>
    <lineSegments geometry={outline}><lineBasicMaterial color={color} transparent opacity={0.55} /></lineSegments>
  </group>;
}

/** Respect the actual polygon, including non-rectangular walkways. */
function Walkway({ polygon }: { polygon: P2[] }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  }, [polygon]);
  const outline = useMemo(() => new THREE.BufferGeometry().setFromPoints([...polygon, polygon[0]].map(([x, z]) => new THREE.Vector3(x, 0.014, z))), [polygon]);
  useEffect(() => () => { geometry.dispose(); outline.dispose(); }, [geometry, outline]);
  return <group>
    <mesh geometry={geometry} position={[0, 0.007, 0]}><meshBasicMaterial color="#eed081" transparent opacity={0.08} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <lineLoop geometry={outline}><lineBasicMaterial color="#e2bd60" transparent opacity={0.65} /></lineLoop>
  </group>;
}

/** Parcels follow the configured polyline only while its actual conveyor is running. */
function Conveyor({ conveyor, lite }: { conveyor: LayoutConveyor; lite: boolean }) {
  const state = useStore(store => store.twin.conveyors[conveyor.id]);
  const selected = useStore(store=>store.selection?.id===conveyor.id);
  const beltTexture = useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#9aa7ab';ctx.fillRect(0,0,64,64);ctx.fillStyle='#68777b';ctx.fillRect(0,0,3,64);
    ctx.fillStyle='#839296';for(let y=0;y<64;y+=4)ctx.fillRect(0,y,64,1);
    const map=new THREE.CanvasTexture(canvas);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(conveyor.length_m??4,2);return map;
  },[conveyor]);
  useEffect(()=>()=>beltTexture.dispose(),[beltTexture]);
  const lastTick=useRef(0);
  useFrame(()=>{const tick=useStore.getState().twin.sim.tick;if(lastTick.current&&tick>=lastTick.current&&state?.status==='RUNNING')beltTexture.offset.x-=(tick-lastTick.current)*.1*state.speed_mps;lastTick.current=tick;});
  const status = state?.status ?? "STOPPED";
  const beltSpeed = state?.speed_mps ?? 0;
  const parcelsRef = useRef<THREE.InstancedMesh>(null!);
  const travelled = useRef(0);
  const parcelCount = layout.conveyor_network ? 0 : Math.max(0, Math.min(lite ? 12 : 32, state?.items_on_belt ?? 0));
  const geometry = useMemo(() => {
    const segments: { ax: number; az: number; angle: number; length: number; start: number }[] = [];
    const belt: Part[] = [], steel: Part[] = [], legs: Part[] = [], rollers: Part[] = [], indicators: Part[] = [];
    let total = 0;
    for (let index = 0; index < conveyor.path.length - 1; index++) {
      const [ax, az] = conveyor.path[index], [bx, bz] = conveyor.path[index + 1];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.01) continue;
      const angle = Math.atan2(bz - az, bx - ax), x = (ax + bx) / 2, z = (az + bz) / 2, width = conveyor.width;
      segments.push({ ax, az, angle, length, start: total }); total += length;
      belt.push({ at: [x, 0.82, z], size: [length, 0.1, width * 0.88], yaw: -angle });
      for (const side of [-1, 1]) {
        const distance = side * (width / 2 - 0.035);
        steel.push({ at: [x - Math.sin(angle) * distance, 0.77, z + Math.cos(angle) * distance], size: [length, 0.24, 0.06], yaw: -angle });
        steel.push({ at: [x - Math.sin(angle) * distance, 1.0, z + Math.cos(angle) * distance], size: [length, 0.055, 0.045], yaw: -angle });
      }
      const supportCount = Math.max(2, Math.ceil(length / 3));
      for (let index = 0; index < supportCount; index++) {
        const distance = length * (index + 0.5) / supportCount;
        const sx=ax+Math.cos(angle)*distance,sz=az+Math.sin(angle)*distance;
        for(const side of [-1,1]){
          legs.push({at:[sx-Math.sin(angle)*side*width*.38,.38,sz+Math.cos(angle)*side*width*.38],size:[.1,.76,.1],yaw:-angle});
          legs.push({at:[sx-Math.sin(angle)*side*width*.38,.035,sz+Math.cos(angle)*side*width*.38],size:[.3,.07,.22],yaw:-angle});
        }
        legs.push({at:[sx,.24,sz],size:[.1,.09,width*.8],yaw:-angle});
      }
      if (!lite) {
        const count = Math.min(50, Math.ceil(length / 0.65));
        for (let index = 0; index < count; index++) {
          const distance = length * (index + 0.5) / count;
          rollers.push({ at: [ax + Math.cos(angle) * distance, 0.877, az + Math.sin(angle) * distance], size: [0.035, 0.015, width * 0.82], yaw: -angle });
        }
      }
      const inset = Math.min(0.25, length / 3);
      indicators.push({ at: [ax + Math.cos(angle) * inset, 0.92, az + Math.sin(angle) * inset], size: [0.08, 0.04, width * 0.7], yaw: -angle });
    }
    return { segments, total, belt, steel, legs, rollers, indicators };
  }, [conveyor, lite]);
  useFrame((_, delta) => {
    if (!parcelsRef.current || geometry.total <= 0 || parcelCount === 0) return;
    const store = useStore.getState();
    const direction = conveyor.direction === "REVERSE" ? -1 : 1;
    if (status === "RUNNING" && !store.paused) travelled.current = (travelled.current + beltSpeed * store.speed * Math.min(delta, 0.1) * direction) % geometry.total;
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1);
    for (let index = 0; index < parcelCount; index++) {
      const distance = ((travelled.current + index * geometry.total / parcelCount) % geometry.total + geometry.total) % geometry.total;
      const segment = geometry.segments.find(part => distance <= part.start + part.length) ?? geometry.segments[geometry.segments.length - 1];
      const t = distance - segment.start;
      position.set(segment.ax + Math.cos(segment.angle) * t, 1.09, segment.az + Math.sin(segment.angle) * t);
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -segment.angle); matrix.compose(position, rotation, scale);
      parcelsRef.current.setMatrixAt(index, matrix);
    }
    parcelsRef.current.instanceMatrix.needsUpdate = true;
  });
  if (!geometry.total) return null;
  const indicatorColor = status === "RUNNING" ? "#82cbad" : status === "ERROR" ? "#ee7567" : "#dbb76d";
  const start = conveyor.path[0];
  return <group>
    <Parts parts={geometry.belt} map={beltTexture} color={selected ? "#668e98" : status === "ERROR" ? "#603a3a" : "#34434a"} metalness={0.2} />
    <Parts parts={geometry.steel} color={conveyor.role==='perimeter'?"#d2ae68":"#94a7ae"} metalness={0.75} /><Parts parts={geometry.legs} color="#405761" metalness={0.65} />
    <Parts parts={geometry.rollers} color="#697e89" metalness={0.7} /><Parts parts={geometry.indicators} color={indicatorColor} emissive />
    {parcelCount > 0 && <instancedMesh ref={parcelsRef} args={[undefined, undefined, parcelCount]} castShadow frustumCulled={false}>
      <boxGeometry args={[0.58, 0.4, Math.min(0.5, conveyor.width * 0.65)]} /><meshStandardMaterial color="#ba956b" roughness={0.94} />
    </instancedMesh>}
    {!lite && <group position={[start[0],0,start[1]]} rotation-y={-geometry.segments[0].angle}>
      <mesh position={[Math.min(.65,geometry.total/2),.56,conveyor.width*.28]} castShadow><boxGeometry args={[.38,.26,.3]}/><meshStandardMaterial color="#436c7e" metalness={.65} roughness={.4}/></mesh>
      {(conveyor.id.startsWith('IND-')||conveyor.id.startsWith('EXIT-'))&&<group position-x={Math.min(.6,geometry.total/2)}>
        {[-1,1].map(side=><mesh key={side} position={[0,1.28,side*conveyor.width*.46]}><boxGeometry args={[.065,.85,.06]}/><meshStandardMaterial color="#e2b760" metalness={.4}/></mesh>)}
        <mesh position={[0,1.72,0]}><boxGeometry args={[.09,.08,conveyor.width]}/><meshStandardMaterial color="#d8ae5d" metalness={.4}/></mesh>
        <mesh position={[0,1.66,0]}><boxGeometry args={[.12,.05,.22]}/><meshStandardMaterial color="#293a47"/></mesh>
        <mesh position={[0,1.62,0]}><boxGeometry args={[.035,.008,conveyor.width*.75]}/><meshBasicMaterial color="#ee665c" transparent opacity={.7}/></mesh>
      </group>}
      <mesh position={[Math.min(1.8,geometry.total*.75),.9,0]} rotation-y={Math.PI/2}><coneGeometry args={[.13,.4,3]}/><meshBasicMaterial color="#d2b270"/></mesh>
    </group>}
    {!lite && <NearbyLabel position={[start[0], 2.0, start[1]]} text={conveyor.id} color={indicatorColor} />}
  </group>;
}

/** Industrial equipment never extends outside its registered station/conveyor footprint. */
export function Fixtures({ lite = false }: { lite?: boolean }) {
  const robots = useStore(store => store.twin.robots);
  const parts = useMemo(() => {
    const steel: Part[] = [], worktops: Part[] = [], cabinets: Part[] = [], packages: Part[] = [], screens: Part[] = [], tape: Part[] = [];
    for (const station of layout.stations) {
      const [x0, z0, x1, z1] = station.rect, width = x1 - x0, depth = z1 - z0;
      const count = Math.max(1, Math.floor(width / 4));
      const benchWidth = Math.min(2.7, width / count - 0.4), benchDepth = Math.min(1.3, depth - 0.4);
      if (benchWidth <= 0 || benchDepth <= 0) continue;
      for (let index = 0; index < count; index++) {
        const x = x0 + width * (index + 0.5) / count, z = (z0 + z1) / 2;
        worktops.push({ at: [x, 1, z], size: [benchWidth, 0.12, benchDepth] });
        cabinets.push({ at: [x, 0.42, z], size: [benchWidth * 0.72, 0.65, benchDepth * 0.84] });
        for (const side of [-1, 1]) {
          steel.push({ at: [x + side * benchWidth * 0.42, 0.48, z], size: [0.1, 0.96, benchDepth * 0.8] });
          if (!lite) steel.push({ at: [x + side * benchWidth * 0.42, 1.62, z + benchDepth * 0.37], size: [0.05, 1.15, 0.05] });
        }
        if (!lite) {
          steel.push({ at: [x, 2.17, z + benchDepth * 0.37], size: [benchWidth * 0.88, 0.05, 0.15] });
          worktops.push({ at: [x, 2.14, z + benchDepth * 0.37], size: [benchWidth * 0.72, 0.025, 0.09] });
          screens.push({ at: [x - benchWidth * 0.3, 1.33, z + benchDepth * 0.22], size: [Math.min(0.43, benchWidth * 0.2), 0.33, 0.06] });
        }
        packages.push({ at: [x + benchWidth * 0.15, 1.29, z], size: [Math.min(0.65, benchWidth * 0.3), 0.46, Math.min(0.55, benchDepth * 0.6)] });
        tape.push({ at: [x + benchWidth * 0.15, 1.523, z], size: [0.08, 0.006, Math.min(0.55, benchDepth * 0.6)] });
      }
    }
    return { steel, worktops, cabinets, packages, screens, tape };
  }, [lite]);
  return <group>
    {layout.conveyor_network && <ConveyorParcels />}
    {layout.conveyors.map(conveyor => <Conveyor key={conveyor.id} conveyor={conveyor} lite={lite} />)}
    <Parts parts={parts.steel} color="#506670" metalness={0.65} /><Parts parts={parts.worktops} color="#b8c5c4" metalness={0.45} />
    <Parts parts={parts.cabinets} color="#365564" metalness={0.35} /><Parts parts={parts.packages} color="#b89063" metalness={0} />
    <Parts parts={parts.screens} color="#72bbbf" emissive /><Parts parts={parts.tape} color="#dec7a0" metalness={0} />
    {layout.stations.map(station => <group key={station.id}>
      <FloorArea rect={station.rect} color={station.kind === "PACKING" ? "#86b7bc" : "#b4abc4"} />
      {!lite && <NearbyLabel position={[(station.rect[0] + station.rect[2]) / 2, 2.5, (station.rect[1] + station.rect[3]) / 2]} text={`${station.id} · ${({PACKING:"PAKETLEME",SORTING:"AYRIŞTIRMA",QUALITY:"KALİTE KONTROL",MAINTENANCE:"BAKIM"} as Record<string,string>)[station.kind] ?? station.kind}`} />}
    </group>)}
    {layout.charging_stations.map(charger => {
      const [x, , z] = charger.position;
      const occupied = Object.values(robots).some(robot => robot.status === "CHARGING" && Math.hypot(robot.position[0] - charger.access_point[0], robot.position[2] - charger.access_point[1]) < 1.5);
      // The navigation layer reserves a 0.9 x 0.9 m footprint for each charger.
      return <group key={charger.id} position={[x, 0, z]} rotation-y={charger.heading}>
        <mesh position={[0, 0.59, 0]} castShadow><boxGeometry args={[0.7, 1.18, 0.38]} /><meshStandardMaterial color="#3f5965" metalness={0.55} roughness={0.5} /></mesh>
        <mesh position={[0, 0.85, 0.195]}><planeGeometry args={[0.38, 0.19]} /><meshBasicMaterial color={occupied ? "#80b7ed" : "#78c4a4"} /></mesh>
        <mesh position={[0, 0.1, 0.09]}><boxGeometry args={[0.78, 0.14, 0.58]} /><meshStandardMaterial color="#354954" metalness={0.65} roughness={0.55} /></mesh>
      </group>;
    })}
    {layout.parking.map(parking => <FloorArea key={parking.id} rect={parking.rect} color="#b5c5c8" slots={parking.slots} opacity={0.055} />)}
    {layout.restricted_areas.map(area => <FloorArea key={area.id} rect={area.rect} color="#d1966e" opacity={0.12} />)}
    {layout.walkways.filter(walkway => walkway.polygon.length >= 3).map(walkway => <Walkway key={walkway.id} polygon={walkway.polygon} />)}
  </group>;
}
