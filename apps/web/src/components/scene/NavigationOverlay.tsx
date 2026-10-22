import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { layout, useStore } from '../../state/store';
import type { P2 } from '../../layout/types';
const noRaycast=()=>{};
const dirs:P2[]=[[1,0],[-1,0],[0,1],[0,-1]];
function Lines({points,color,opacity=.7}:{points:number[];color:string;opacity?:number}){
  const geometry=useMemo(()=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),[points]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <lineSegments geometry={geometry} raycast={noRaycast}><lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false}/></lineSegments>;
}
function Marks({cells,size,color,y}:{cells:P2[];size:number;color:string;y:number}){
  const ref=useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(()=>{if(!ref.current)return;const m=new THREE.Object3D(),cs=layout.grid.cell_size;cells.forEach(([c,r],i)=>{m.position.set((c+.5)*cs,y,(r+.5)*cs);m.rotation.x=-Math.PI/2;m.scale.setScalar(size);m.updateMatrix();ref.current.setMatrixAt(i,m.matrix);});ref.current.instanceMatrix.needsUpdate=true;ref.current.computeBoundingSphere();},[cells,size,y]);
  if(!cells.length)return null;
  return <instancedMesh ref={ref} args={[undefined,undefined,cells.length]} raycast={noRaycast}><planeGeometry/><meshBasicMaterial color={color} transparent opacity={.75} depthWrite={false} side={THREE.DoubleSide}/></instancedMesh>;
}
/** Static graph geometry is cached per floor. Nodes and closures use one batch per color. */
export function NavigationOverlay(){
  const layers=useStore(s=>s.layers),af=useStore(s=>s.activeFloor),snap=useStore(s=>s.navigation),source=useStore(s=>s.source);
  const floor=typeof af==='number'?af:1,graph=layout.navigation_graph,data=graph?.floors[String(floor)],cs=layout.grid.cell_size;
  const y=(layout.floors.find(f=>f.id===floor)?.elevation??0)+(af==='exploded'&&floor===2?5:0)+.18;
  const edges=useMemo(()=>{
    const normal:number[]=[],arrows:number[]=[];
    if(data)for(let r=0;r<data.rows;r++)for(let c=0;c<data.cols;c++)dirs.forEach(([dx,dz],bit)=>{
      if(!(data.outgoing[r*data.cols+c]&(1<<bit)))return;
      const nc=c+dx,nr=r+dz,reverse=!!(data.outgoing[nr*data.cols+nc]&(1<<(bit^1)));
      const x=(c+.5)*cs,z=(r+.5)*cs,bx=(nc+.5)*cs,bz=(nr+.5)*cs;
      if(!reverse){arrows.push(x,0,z,bx,0,bz);for(const sign of [-1,1])arrows.push(bx-dx*.35+dz*.18*sign,0,bz-dz*.35-dx*.18*sign,bx,0,bz);}
      else if(bit===0||bit===2)normal.push(x,0,z,bx,0,bz);
    });return {normal,arrows};
  },[data,cs]);
  const nodes=useMemo(()=>{
    const access:P2[]=[],charging:P2[]=[],invalid:P2[]=[],spawns:P2[]=[];
    for(const n of graph?.nodes??[])if(n.floor===floor)(!n.valid?invalid:n.kind==='SPAWN'?spawns:n.kind==='CHARGING'?charging:access).push(n.cell);
    return {access,charging,invalid,spawns};
  },[graph,floor]);
  const current=source==='online'&&snap?.floor===floor?snap:null;
  const blocked=useMemo(()=>{const p:number[]=[];for(const [a,b] of current?.blocked_edges??[]){const x=(a[0]+.5)*cs,z=(a[1]+.5)*cs,bx=(b[0]+.5)*cs,bz=(b[1]+.5)*cs,dx=b[0]-a[0],dz=b[1]-a[1];p.push(x,.04,z,bx,.04,bz);for(const s of [-1,1])p.push(bx-dx*.3+dz*.18*s,.04,bz-dz*.3-dx*.18*s,bx,.04,bz);}return p;},[current,cs]);
  if(!data)return null;
  return <group position-y={y}>
    {layers.graph&&<><Lines points={edges.normal} color="#147997" opacity={.8}/><Lines points={edges.arrows} color="#ffcb6c"/></>}
    {layers.junctions&&<Marks cells={data.junctions} size={.16*cs} color="#bd861f" y={.02}/>}
    {layers.access&&<><Marks cells={nodes.access} size={.7*cs} color="#68edb8" y={.05}/><Marks cells={nodes.charging} size={.8*cs} color="#bf93fa" y={.05}/><Marks cells={nodes.spawns} size={.5*cs} color="#f5f9ff" y={.05}/><Marks cells={nodes.invalid} size={cs} color="#ff536b" y={.06}/></>}
    {layers.closures&&current&&<><Marks cells={current.blocked_cells} size={.94*cs} color="#ff536b" y={.04}/><Lines points={blocked} color="#ff536b" opacity={1}/></>}
  </group>;
}
