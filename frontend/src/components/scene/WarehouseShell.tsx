import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { layout } from "../../state/store";
import { sceneBounds } from "../../layout/sceneBounds";

function paint(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d")! };
}
function makeTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** All structural columns use the exact collision rectangles from the layout. */
function Columns({ height }: { height: number }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const columns = useMemo(() => layout.obstacles.filter(obstacle => obstacle.kind === "PILLAR"), []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < columns.length; i++) {
      const [x0, z0, x1, z1] = columns[i].rect;
      matrix.makeScale(x1 - x0, height, z1 - z0).setPosition((x0 + x1) / 2, height / 2, (z0 + z1) / 2);
      ref.current.setMatrixAt(i, matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [columns, height]);
  if (!columns.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, columns.length]} castShadow receiveShadow>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#9eaab1" roughness={0.58} metalness={0.35} />
  </instancedMesh>;
}

/** Layout-driven shell; floor joints and safety markings are textures, not extra solids. */
export function WarehouseShell({ lite = false }: { lite?: boolean }) {
  const { width: W, depth: D, height: H } = layout.size;
  const site = sceneBounds(layout);
  const exterior = layout.conveyor_network?.placement === 'exterior';
  // Parcel-sized wall openings connect indoor handoff positions to outdoor belts.
  // The navigation wall stays closed to robots.
  const ports = useMemo(() => exterior ? [
    ...Object.values(layout.conveyor_network!.induction_points).map(p=>({
      id:p.id, side:p.access_point[0]<W/2?'west':'east', along:p.access_point[1],
    })),
    ...Object.entries(layout.conveyor_network!.transfer_points??{}).map(([id,p])=>({id,side:p.wall,along:p.position[0]})),
  ] : [], [exterior,W]);
  const walls = useMemo(()=>{
    const parts:{position:[number,number,number];size:[number,number,number];horizontal:boolean}[]=[];
    for(const side of ['north','south','west','east']){
      const horizontal=side==='north'||side==='south',length=horizontal?W:D;
      const fixed=side==='south'?D:side==='east'?W:0;
      const add=(from:number,to:number,bottom=0,top=H)=>{
        if(to<=from)return;
        parts.push({position:horizontal?[(from+to)/2,(bottom+top)/2,fixed]:[fixed,(bottom+top)/2,(from+to)/2],size:horizontal?[to-from,top-bottom,.35]:[.35,top-bottom,to-from],horizontal});
      };
      let previous=0;
      for(const port of ports.filter(p=>p.side===side).sort((a,b)=>a.along-b.along)){
        add(previous,port.along-.9);add(port.along-.9,port.along+.9,0,.65);add(port.along-.9,port.along+.9,1.9,H);previous=port.along+.9;
      }
      add(previous,length);
    }
    return parts;
  },[ports,W,D,H]);
  const textures = useMemo(() => {
    const floor = paint(512, 512), f = floor.ctx;
    f.fillStyle = "#909b9f"; f.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4500; i++) {
      f.fillStyle = i % 2 ? "rgba(245,248,245,.035)" : "rgba(37,52,61,.025)";
      f.fillRect((i * 127) % 512, (i * 61 + Math.floor(i / 512) * 23) % 512, 2, 2);
    }
    f.strokeStyle = "rgba(40,60,69,.16)"; f.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const p = i * 256; f.beginPath(); f.moveTo(p, 0); f.lineTo(p, 512); f.moveTo(0, p); f.lineTo(512, p); f.stroke();
    }
    const floorMap = makeTexture(floor.canvas);
    floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
    floorMap.repeat.set(W / 8, D / 8);

    const wall = paint(256, 512), w = wall.ctx;
    w.fillStyle = "#d8dedc"; w.fillRect(0, 0, 256, 512);
    for (let x = 0; x < 256; x += 32) {
      w.fillStyle = "rgba(80,100,108,.16)"; w.fillRect(x, 0, 2, 512);
      w.fillStyle = "rgba(255,255,255,.32)"; w.fillRect(x + 2, 0, 1, 512);
    }
    w.fillStyle = "#70818c"; w.fillRect(0, 432, 256, 80);
    w.fillStyle = "#65a7ad"; w.fillRect(0, 428, 256, 4);
    const wallX = makeTexture(wall.canvas), wallZ = wallX.clone();
    wallX.wrapS = wallZ.wrapS = THREE.RepeatWrapping;
    wallX.repeat.set(W / 8, 1); wallZ.repeat.set(D / 8, 1);

    const doors = layout.docks.map(dock => {
      const door = paint(512, 512), d = door.ctx;
      d.fillStyle = "#546974"; d.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 34) {
        d.fillStyle = "#3c505d"; d.fillRect(0, y, 512, 3);
        d.fillStyle = "#8a989e"; d.fillRect(0, y + 3, 512, 2);
      }
      d.fillStyle = "#253a45"; d.fillRect(22, 20, 468, 110);
      d.fillStyle = dock.kind === "INBOUND" ? "#eac172" : "#8cd5d0";
      d.font = "700 30px sans-serif"; d.textAlign = "center";
      d.fillText(dock.kind === "INBOUND" ? "MAL KABUL" : "SEVKİYAT", 256, 64);
      d.fillStyle = "#e4eeed"; d.font = "500 22px sans-serif"; d.fillText(dock.id, 256, 105);
      d.fillStyle = "#aebbc0"; d.fillRect(205, 350, 102, 9);
      return makeTexture(door.canvas);
    });
    const signs = layout.zones.map(zone => {
      const sign = paint(768, 160), s = sign.ctx;
      s.fillStyle = "#334955"; s.fillRect(0, 0, 768, 160);
      s.fillStyle = zone.color; s.fillRect(0, 0, 12, 160);
      s.font = "700 90px sans-serif"; s.fillText(zone.id, 34, 116);
      s.fillStyle = "#e8efed"; s.font = "600 30px sans-serif";
      s.fillText(zone.name.toLocaleUpperCase("tr-TR"), 154, 70, 585);
      s.fillStyle = "#a8bdc2"; s.font = "400 22px sans-serif";
      s.fillText(`BÖLGE ${zone.id} · ${(zone.floor ?? 1) === 1 ? "ZEMİN KAT" : `${zone.floor}. KAT`}`, 155, 116);
      return makeTexture(sign.canvas);
    });
    const staging = paint(512, 512), s = staging.ctx;
    s.clearRect(0, 0, 512, 512);
    s.strokeStyle = "#ead29a"; s.lineWidth = 7; s.strokeRect(8, 8, 496, 496);
    s.globalAlpha = 0.4; s.lineWidth = 4;
    for (let x = 128; x < 512; x += 128) { s.beginPath(); s.moveTo(x, 32); s.lineTo(x, 480); s.stroke(); }
    s.globalAlpha = 1;
    for (let x = 50; x < 512; x += 128) {
      s.beginPath(); s.moveTo(x, 150); s.lineTo(x, 350); s.moveTo(x - 17, 174); s.lineTo(x, 150); s.lineTo(x + 17, 174); s.stroke();
    }
    return { floor: floorMap, wallX, wallZ, doors, signs, staging: makeTexture(staging.canvas) };
  }, [W, D]);
  useEffect(() => () => {
    [textures.floor, textures.wallX, textures.wallZ, textures.staging, ...textures.doors, ...textures.signs].forEach(texture => texture.dispose());
  }, [textures]);

  return <group>
    {exterior && <>
      <mesh rotation-x={-Math.PI/2} position={[site.center[0],-.035,site.center[2]]} receiveShadow>
        <planeGeometry args={[site.width,site.depth]}/><meshStandardMaterial color="#53666b" roughness={.95}/>
      </mesh>
      {[
        {at:[W/2,.008,site.z0+.3],size:[site.width-.6,.045]},
        {at:[W/2,.008,site.z1-.3],size:[site.width-.6,.045]},
        {at:[site.x0+.3,.008,D/2],size:[.045,site.depth-.6]},
        {at:[site.x1-.3,.008,D/2],size:[.045,site.depth-.6]},
      ].map((line,i)=><mesh key={i} position={line.at as [number,number,number]} rotation-x={-Math.PI/2}>
        <planeGeometry args={line.size as [number,number]}/><meshBasicMaterial color="#d4b16d"/>
      </mesh>)}
      {ports.map(port=>{
        const horizontal=port.side==='north'||port.side==='south';
        const position:[number,number,number]=horizontal?[port.along,0,port.side==='north'?0:D]:[port.side==='west'?0:W,0,port.along];
        return <group key={port.id} position={position} rotation-y={horizontal?0:Math.PI/2}>
          <mesh position={[0,1.98,0]}><boxGeometry args={[2.1,.16,.55]}/><meshStandardMaterial color="#e0b969" metalness={.4}/></mesh>
          {[-1,1].map(sign=><mesh key={sign} position={[sign*.98,1.27,0]}><boxGeometry args={[.16,1.4,.55]}/><meshStandardMaterial color="#e0b969" metalness={.4}/></mesh>)}
          <mesh position={[0,.76,0]}><boxGeometry args={[1.8,.16,1.6]}/><meshStandardMaterial color="#69848c" metalness={.55}/></mesh>
        </group>;
      })}
    </>}
    <mesh rotation-x={-Math.PI / 2} position={[W / 2, 0, D / 2]} receiveShadow>
      <planeGeometry args={[W, D]} /><meshStandardMaterial map={textures.floor} roughness={0.87} metalness={0.035} />
    </mesh>
    {/* Wall volumes hug the perimeter; overhead trusses and lamps are owned by IndustrialDetails. */}
    {walls.map((wall, index) => <mesh key={index} position={wall.position} receiveShadow>
      <boxGeometry args={wall.size} /><meshStandardMaterial map={wall.horizontal?textures.wallX:textures.wallZ} roughness={0.83} metalness={0.12} />
    </mesh>)}
    <Columns height={H} />
    {!lite && layout.zones.filter(zone => (zone.floor ?? 1) === 1).map(zone => {
      const index = layout.zones.indexOf(zone), xs = zone.polygon.map(p => p[0]), zs = zone.polygon.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const width = Math.min(7, (x1 - x0) * 0.65), depth = Math.min(width / 4.8, (z1 - z0) * 0.12);
      return <mesh key={zone.id} position={[(x0 + x1) / 2, 0.019, z0 + depth / 2 + 0.5]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[width, depth]} /><meshStandardMaterial map={textures.signs[index]} roughness={0.98} polygonOffset polygonOffsetFactor={-2} />
      </mesh>;
    })}
    {layout.docks.map((dock, index) => {
      const [x0, z0, x1, z1] = dock.rect;
      const distances = [dock.door[1], D - dock.door[1], dock.door[0], W - dock.door[0]];
      const edge = distances.indexOf(Math.min(...distances));
      const yaw = [0, Math.PI, Math.PI / 2, -Math.PI / 2][edge];
      const width = Math.min(5.5, (edge < 2 ? x1 - x0 : z1 - z0) * 0.72);
      const height = Math.min(4.8, H * 0.5);
      const inward = [Math.sin(yaw), Math.cos(yaw)];
      const doorX = dock.door[0] + inward[0] * (layout.metadata ? .5 : .22);
      const doorZ = dock.door[1] + inward[1] * (layout.metadata ? .5 : .22);
      return <group key={dock.id}>
        <mesh position={[(x0 + x1) / 2, 0.012, (z0 + z1) / 2]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[Math.max(0.1, x1 - x0 - 0.4), Math.max(0.1, z1 - z0 - 0.4)]} /><meshBasicMaterial map={textures.staging} color={dock.kind === "INBOUND" ? "#edd29b" : "#a1d8da"} transparent opacity={0.7} depthWrite={false} />
        </mesh>
        <group position={[doorX, 0, doorZ]} rotation-y={yaw}>
          <mesh position={[0, height / 2, 0]}><boxGeometry args={[width, height, 0.12]} /><meshStandardMaterial map={textures.doors[index]} roughness={0.65} metalness={0.3} /></mesh>
          <mesh position={[0, height + 0.12, 0]}><boxGeometry args={[width + 0.3, 0.2, 0.22]} /><meshStandardMaterial color={dock.kind === "INBOUND" ? "#d7ad55" : "#5eabb4"} roughness={0.6} metalness={0.3} /></mesh>
          {[-1, 1].map(side => <mesh key={side} position={[side * (width / 2 + 0.06), height / 2, 0]}><boxGeometry args={[0.12, height, 0.18]} /><meshStandardMaterial color="#354c5a" roughness={0.6} metalness={0.5} /></mesh>)}
        </group>
      </group>;
    })}
  </group>;
}
