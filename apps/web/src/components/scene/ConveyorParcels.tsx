import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import {Line} from '@react-three/drei';
import * as THREE from 'three';
import {layout,useStore} from '../../state/store';
import type {Parcel} from '../../schema/conveyor';
import {presentation, parcelAt, parcelPose, robotPose, robotParcelPose, robotElevation} from '../../simulation/presentation';
import {FLOOR_ELEV} from './Mezzanine';
import {parcelColor} from './parcelPresentation';
const segments=Object.fromEntries(layout.conveyors.map(c=>[c.id,c]));
export function parcelPosition(p:Parcel):[number,number,number]{
 return parcelAt(p, segments);
}
/** One instanced batch per material. Positions interpolate authoritative snapshots;
 * the render clock cannot complete tasks, transfer owners or advance simulation. */
export function ConveyorParcels(){
 const all=useStore(s=>s.twin.packages),selection=useStore(s=>s.selection),paths=useStore(s=>s.showPaths);
 const mesh=useRef<THREE.InstancedMesh>(null!),labels=useRef<THREE.InstancedMesh>(null!);
 const drawnIds=useRef<string[]>([]);
 const ids=Object.values(all??{}).filter(p=>p.status!=='DELIVERED'||useStore.getState().twin.sim.tick-(p.delivered_at??0)<=10).map(p=>p.package_id);
 const capacity=Math.max(1,2**Math.ceil(Math.log2(Math.max(1,ids.length))));
 const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#eee7d5';ctx.fillRect(0,0,128,128);ctx.fillStyle='#1e2c31';for(let i=10;i<118;i+=4)ctx.fillRect(i,28,(i%7)+1,55);ctx.font='bold 12px monospace';ctx.fillText('WARETWIN',26,18);ctx.font='10px monospace';ctx.fillText('ID TRACKED',20,104);return new THREE.CanvasTexture(canvas);},[]);
 useEffect(()=>()=>texture.dispose(),[texture]);
 const object=useMemo(()=>new THREE.Object3D(),[]),color=useMemo(()=>new THREE.Color(),[]);
 useFrame(()=>{
  if(!mesh.current||!labels.current)return;
  const state=useStore.getState(),packages=state.twin.packages??{},frame=presentation.sample();let count=0;
  for(const id of ids){const current=packages[id];if(!current)continue;
   const sampled=parcelPose(frame,current,segments),p=sampled.parcel;
   if(p.status==='DELIVERED')continue;
   const c=segments[p.current_conveyor_segment??p.route[0]];if(!c)continue;
   const a=c.path[0],b=c.path[c.path.length-1];
   let target=sampled.position,yaw=-Math.atan2(b[1]-a[1],b[0]-a[0]);
   if(p.status!=='ON_CONVEYOR'){
    const sampledState=frame?(frame.u<1?frame.a:frame.b):state.twin;
    const robotId=p.robot_id??sampledState.tasks[p.task_id]?.assigned_robot;
    const r=robotId?sampledState.robots[robotId]:null;if(!r)continue;
    const pose=robotPose(frame,r);
    if(p.status==='AWAITING_PICKUP'&&pose.robot.fsm!=='PICKING')continue;
    const carried=robotParcelPose(frame,p,r,segments,robotElevation(frame,pose.robot,FLOOR_ELEV,state.activeFloor==='exploded'));
    target=carried.position;yaw=-carried.heading;
   }
   object.position.set(...target);object.rotation.set(0,yaw,0);object.scale.set(...p.package_dimensions);object.updateMatrix();mesh.current.setMatrixAt(count,object.matrix);drawnIds.current[count]=id;
   color.set(parcelColor(p,selection?.id===id||selection?.kind==='order'&&selection.id===p.order_id));mesh.current.setColorAt(count,color);
   object.position.y+=p.package_dimensions[1]/2+.003;object.rotation.x=-Math.PI/2;object.scale.set(.23,.25,1);object.updateMatrix();labels.current.setMatrixAt(count,object.matrix);count++;
  }
  mesh.current.count=count;labels.current.count=count;mesh.current.instanceMatrix.needsUpdate=true;labels.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;
 });
 const selected=selection?.kind==='package'?all?.[selection.id]:null;
 const route=selected?.route.flatMap(id=>segments[id]?.path.map(p=>[p[0],1.4,p[1]] as [number,number,number])??[]);
 return <group><instancedMesh key={`boxes-${capacity}`} ref={mesh} args={[undefined,undefined,capacity]} frustumCulled={false} castShadow onClick={e=>{if(e.instanceId==null)return;e.stopPropagation();useStore.getState().inspect({kind:'package',id:drawnIds.current[e.instanceId]});}}><boxGeometry/><meshStandardMaterial roughness={.92}/></instancedMesh><instancedMesh key={`labels-${capacity}`} ref={labels} args={[undefined,undefined,capacity]} frustumCulled={false} raycast={()=>{}}><planeGeometry/><meshStandardMaterial map={texture} roughness={.95}/></instancedMesh>{selected&&paths&&route&&route.length>1&&<Line points={route} color="#e3ba6f" lineWidth={2} dashed dashSize={.6} gapSize={.35}/>}</group>;
}
