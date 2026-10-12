import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {Line} from '@react-three/drei';
import * as THREE from 'three';
import {layout,useStore} from '../../state/store';
import type {Parcel} from '../../schema/conveyor';
const segments=Object.fromEntries(layout.conveyors.map(c=>[c.id,c]));
export function parcelPosition(p:Parcel):[number,number,number]{
 const c=segments[p.current_conveyor_segment??p.route[0]],a=c.path[0],b=c.path[c.path.length-1];
 const t=p.conveyor_position/(c.length_m??Math.hypot(b[0]-a[0],b[1]-a[1]));
 return [a[0]+(b[0]-a[0])*t,.875+p.package_dimensions[1]/2,a[1]+(b[1]-a[1])*t];
}
/** One instanced batch per material. Positions interpolate authoritative snapshots;
 * the render clock cannot complete tasks, transfer owners or advance simulation. */
export function ConveyorParcels(){
 const all=useStore(s=>s.twin.packages),robots=useStore(s=>s.twin.robots),selection=useStore(s=>s.selection),paths=useStore(s=>s.showPaths);
 const mesh=useRef<THREE.InstancedMesh>(null!),labels=useRef<THREE.InstancedMesh>(null!);
 const positions=useRef(new Map<string,THREE.Vector3>());
 const ids=Object.values(all??{}).filter(p=>p.status==='ON_CONVEYOR'||p.status==='LOADING'||(p.status==='WAITING_INDUCTION'&&p.robot_id&&robots[p.robot_id]?.fsm==='DELIVERING')).map(p=>p.package_id);
 const capacity=Math.max(1,2**Math.ceil(Math.log2(Math.max(1,ids.length))));
 const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#eee7d5';ctx.fillRect(0,0,128,128);ctx.fillStyle='#1e2c31';for(let i=10;i<118;i+=4)ctx.fillRect(i,28,(i%7)+1,55);ctx.font='bold 12px monospace';ctx.fillText('WARETWIN',26,18);ctx.font='10px monospace';ctx.fillText('ID TRACKED',20,104);return new THREE.CanvasTexture(canvas);},[]);
 useEffect(()=>()=>texture.dispose(),[texture]);
 const object=useMemo(()=>new THREE.Object3D(),[]),color=useMemo(()=>new THREE.Color(),[]);
 useFrame((_,delta)=>{
  if(!mesh.current||!labels.current)return;
  const state=useStore.getState(),packages=state.twin.packages??{};let count=0;
  for(const id of ids){const p=packages[id];if(!p)continue;const c=segments[p.current_conveyor_segment??p.route[0]],a=c.path[0],b=c.path[c.path.length-1];
   let target=parcelPosition(p),yaw=-Math.atan2(b[1]-a[1],b[0]-a[0]);
   if(p.status!=='ON_CONVEYOR'){
    const r=p.robot_id?state.twin.robots[p.robot_id]:null;if(!r)continue;
    const from:[number,number,number]=[r.position[0]+Math.cos(r.heading)*.47,1.36,r.position[2]+Math.sin(r.heading)*.47];
    const u=p.handoff_started_at==null?0:Math.min(1,Math.max(0,(state.twin.sim.tick-p.handoff_started_at)/29));
    target=from.map((n,i)=>n+(target[i]-n)*(u*u*(3-2*u))) as [number,number,number];
    yaw=-r.heading;
   }
   let pos=positions.current.get(id);if(!pos){pos=new THREE.Vector3(...target);positions.current.set(id,pos);}else pos.lerp(new THREE.Vector3(...target),1-Math.exp(-Math.min(delta,.1)*22));
   object.position.copy(pos);object.rotation.set(0,yaw,0);object.scale.set(...p.package_dimensions);object.updateMatrix();mesh.current.setMatrixAt(count,object.matrix);
   color.set(selection?.id===id?'#f7d486':p.source_zone==='ZONE_A'?'#bda581':p.source_zone==='ZONE_B'?'#c59261':p.source_zone==='ZONE_C'?'#b1ab80':'#bb937c');mesh.current.setColorAt(count,color);
   object.position.y+=p.package_dimensions[1]/2+.003;object.rotation.x=-Math.PI/2;object.scale.set(.23,.25,1);object.updateMatrix();labels.current.setMatrixAt(count,object.matrix);count++;
  }
  mesh.current.count=count;labels.current.count=count;mesh.current.instanceMatrix.needsUpdate=true;labels.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;
  for(const id of positions.current.keys())if(!ids.includes(id))positions.current.delete(id);
 });
 const selected=selection?.kind==='package'?all?.[selection.id]:null;
 const route=selected?.route.flatMap(id=>segments[id]?.path.map(p=>[p[0],1.4,p[1]] as [number,number,number])??[]);
 return <group><instancedMesh key={`boxes-${capacity}`} ref={mesh} args={[undefined,undefined,capacity]} frustumCulled={false} castShadow onClick={e=>{if(e.instanceId==null)return;e.stopPropagation();useStore.getState().inspect({kind:'package',id:ids[e.instanceId]});}}><boxGeometry/><meshStandardMaterial roughness={.92}/></instancedMesh><instancedMesh key={`labels-${capacity}`} ref={labels} args={[undefined,undefined,capacity]} frustumCulled={false} raycast={()=>{}}><planeGeometry/><meshStandardMaterial map={texture} roughness={.95}/></instancedMesh>{selected&&paths&&route&&route.length>1&&<Line points={route} color="#e3ba6f" lineWidth={2} dashed dashSize={.6} gapSize={.35}/>}</group>;
}
