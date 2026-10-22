import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { layout, useStore } from '../../state/store';
import { buildNavGrid } from '../../layout/navgrid';
import { indexObjects, type SceneObject } from './experience';

export const SCENE_OBJECTS=indexObjects(layout);
const box=new THREE.BoxGeometry(1,1,1);
const noRaycast=()=>{};
function InstanceBoxes({objects, picking=false, color='#7caed0',opacity=.15}:{objects:SceneObject[];picking?:boolean;color?:string;opacity?:number}){
  const ref=useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(()=>{ const m=new THREE.Object3D();objects.forEach((o,i)=>{m.position.set(...o.center);m.scale.set(...o.size);m.updateMatrix();ref.current.setMatrixAt(i,m.matrix);});ref.current.instanceMatrix.needsUpdate=true;ref.current.computeBoundingSphere();},[objects]);
  const handle=(event:ThreeEvent<PointerEvent|MouseEvent>, click=false)=>{if(!picking||event.instanceId===undefined||useStore.getState().tool!=='select')return;event.stopPropagation();const o=objects[event.instanceId];if(click)useStore.getState().inspect({kind:o.kind,id:o.id});else useStore.getState().hover({kind:o.kind,id:o.id});};
  return <instancedMesh ref={ref} args={[box,undefined,objects.length]} onClick={e=>handle(e,true)} onPointerMove={e=>handle(e)} onPointerOut={()=>picking&&useStore.getState().hover(null)} raycast={picking?undefined:noRaycast}>
    <meshBasicMaterial color={color} transparent opacity={picking?0:opacity} colorWrite={!picking} depthWrite={false} />
  </instancedMesh>;
}
function Outline({object,selected}:{object:SceneObject;selected:boolean}){
  return <mesh position={object.center} scale={object.size.map(v=>v+.12) as [number,number,number]} raycast={noRaycast}>
    <boxGeometry /><meshBasicMaterial transparent opacity={selected?.035:0} color="#a7dded" depthWrite={false}/>
    <Edges color={selected?'#a3e7f5':'#edce8f'} threshold={15} raycast={noRaycast}/>
  </mesh>;
}
/** Static proxies share one draw call. They do not replace or modify physical geometry. */
export function InteractionLayers(){
  const walking=useStore(s=>s.cameraMode==='walk');
  const layers=useStore(s=>s.layers),selection=useStore(s=>s.selection),hovered=useStore(s=>s.hovered),af=useStore(s=>s.activeFloor);
  const floor=typeof af==='number'?af:1;
  const objects=useMemo(()=>SCENE_OBJECTS.filter(o=>af==='all'||af==='exploded'||o.floor===af).map(o=>af==='exploded'&&o.floor===2?{...o,center:[o.center[0],o.center[1]+5,o.center[2]] as [number,number,number]}:o),[af]);
  const solids=useMemo(()=>objects.filter(o=>o.kind==='rack'||o.kind==='station'||o.kind==='location'||o.kind==='conveyor'),[objects]);
  const zones=useMemo(()=>objects.filter(o=>o.kind==='zone'),[objects]);
  const nav=useMemo(()=>{
    const grid=buildNavGrid(layout,floor),cs=layout.grid.cell_size,ey=layout.floors.find(f=>f.id===floor)?.elevation??0;
    const result:SceneObject[]=[];
    for(let z=0;z<grid.rows;z++){let start=-1;for(let x=0;x<=grid.cols;x++){const free=x<grid.cols&&grid.cells[z*grid.cols+x]!==1;if(free&&start<0)start=x;if(!free&&start>=0){result.push({kind:'location',id:`nav-${z}-${start}`,label:'',detail:'',aliases:[],floor,center:[(start+x)*cs/2,ey+.04,(z+.5)*cs],size:[(x-start)*cs,.025,cs]});start=-1;}}}
    return result;
  },[floor]);
  const obstacles=useMemo(()=>{
    const grid=buildNavGrid(layout,floor),cs=layout.grid.cell_size,ey=layout.floors.find(f=>f.id===floor)?.elevation??0;
    const points:number[]=[];for(let z=0;z<grid.rows;z++)for(let x=0;x<grid.cols;x++)if(grid.cells[z*grid.cols+x]===1){
      const edge=(ax:number,az:number,bx:number,bz:number)=>points.push(ax*cs,ey+.09,az*cs,bx*cs,ey+.09,bz*cs);
      if(z===0||grid.cells[(z-1)*grid.cols+x]!==1)edge(x,z,x+1,z);
      if(z===grid.rows-1||grid.cells[(z+1)*grid.cols+x]!==1)edge(x,z+1,x+1,z+1);
      if(x===0||grid.cells[z*grid.cols+x-1]!==1)edge(x,z,x,z+1);
      if(x===grid.cols-1||grid.cells[z*grid.cols+x+1]!==1)edge(x+1,z,x+1,z+1);
    }
    return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  },[floor]);
  const gridGeometry=useMemo(()=>{const pts:number[]=[];const y=(layout.floors.find(f=>f.id===floor)?.elevation??0)+.035;for(let x=0;x<=layout.size.width;x+=layout.grid.cell_size)pts.push(x,y,0,x,y,layout.size.depth);for(let z=0;z<=layout.size.depth;z+=layout.grid.cell_size)pts.push(0,y,z,layout.size.width,y,z);return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pts,3));},[floor]);
  useEffect(()=>()=>{obstacles.dispose();gridGeometry.dispose();},[obstacles,gridGeometry]);
  useEffect(()=>{document.body.style.cursor=hovered?'pointer':'';return()=>{document.body.style.cursor='';};},[hovered]);
  const selected=objects.find(o=>o.id===selection?.id&&o.kind===selection.kind),hover=objects.find(o=>o.id===hovered?.id&&o.kind===hovered.kind);
  return <group>
    {!walking && <InstanceBoxes objects={solids} picking />}
    {layers.zones&&<InstanceBoxes objects={zones} picking />}
    {selected&&<Outline object={selected} selected />}
    {hover&&hover.id!==selected?.id&&<Outline object={hover} selected={false}/>}
    <group position-y={af==='exploded'&&floor===2?5:0}>
      {layers.corridors&&<InstanceBoxes objects={nav} color="#59b8aa" opacity={.16}/>}
      {layers.obstacles&&<lineSegments geometry={obstacles} raycast={noRaycast}><lineBasicMaterial color="#ed916f" transparent opacity={.85}/></lineSegments>}
      {layers.grid&&<lineSegments geometry={gridGeometry} raycast={noRaycast}><lineBasicMaterial color="#93b2c6" transparent opacity={.18}/></lineSegments>}
    </group>
    {layers.stations&&objects.filter(o=>o.kind==='station'||o.kind==='location').map(o=><mesh key={o.id} position={[o.center[0],(layout.floors.find(f=>f.id===o.floor)?.elevation??0)+(af==='exploded'&&o.floor===2?5:0)+.1,o.center[2]]} rotation-x={-Math.PI/2} raycast={noRaycast}><ringGeometry args={[1.2,1.45,20]}/><meshBasicMaterial color="#d5b979" transparent opacity={.8} depthWrite={false}/></mesh>)}
    {layers.traffic&&<TrafficDirections/>}
  </group>;
}
function TrafficDirections(){
  const robots=useStore(s=>s.twin.robots),af=useStore(s=>s.activeFloor);
  const geometry=useMemo(()=>{const points:number[]=[];for(const r of Object.values(robots)){
    if(typeof af==='number'&&r.floor!==af)continue;
    const y=(layout.floors.find(f=>f.id===r.floor)?.elevation??0)+(af==='exploded'&&r.floor===2?5:0)+.13;
    for(let i=Math.max(1,r.path_index);i<r.path.length;i+=5){const a=r.path[i-1],b=r.path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(!length)continue;const x=(b[0]+.5)*layout.grid.cell_size,z=(b[1]+.5)*layout.grid.cell_size,ux=dx/length,uz=dz/length;for(const sign of [-1,1])points.push(x-ux*.65+uz*.3*sign,y,z-uz*.65-ux*.3*sign,x,y,z);}
  }return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));},[robots,af]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <lineSegments geometry={geometry} raycast={noRaycast}><lineBasicMaterial color="#f1c778" transparent opacity={.9}/></lineSegments>;
}
