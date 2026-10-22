import { describe, expect, it } from 'vitest';
import { SnapshotMotion, robotPose, beltDistance, parcelPose, liftHeight, robotElevation, robotParcelPose } from '../src/simulation/presentation';
import { useStore } from '../src/state/store';
import type { RobotState, TwinState } from '../src/schema/twin_state';
import type { Parcel } from '../src/schema/conveyor';
import type { LayoutConveyor } from '../src/layout/types';
function state(tick: number, speed: TwinState['sim']['speed'] = 1): TwinState {
  const twin=structuredClone(useStore.getState().twin);
  twin.sim={...twin.sim,tick,speed,mode:'LIVE'};
  twin.robots.R01={id:'R01',position:[tick*.1,0,0],heading:0,path:[],path_index:0,fsm:'NAVIGATING',operation_duration_ticks:40,operation_elapsed_ticks:tick} as unknown as RobotState;
  twin.conveyors.C={id:'C',speed_mps:1.2,travelled_m:tick*.12,status:'RUNNING',items_on_belt:1,throughput_per_min:0};
  return twin;
}
describe('bounded warehouse presentation',()=>{
  it('keeps a robot on its lift through motion, pause and a floor change',()=>{
    const a=state(0),b=state(1);
    a.lifts.L={y:1} as any;b.lifts.L={y:1.2} as any;
    a.robots.R01={...a.robots.R01,floor:1,lift_id:'L'};
    b.robots.R01={...b.robots.R01,floor:1,lift_id:'L'};
    for(const u of [0,.25,.5,1]){
      const frame={a,b,u,tick:u},pose=robotPose(frame,b.robots.R01);
      expect(robotElevation(frame,pose.robot,{1:0,2:5})).toBe(liftHeight(frame,'L'));
    }
    b.lifts.L.y=5;b.robots.R01={...b.robots.R01,floor:2,lift_id:null};
    expect(robotElevation({a:b,b,u:1,tick:1},b.robots.R01,{1:0,2:5})).toBe(5);
  });
  it('uses the core dwell for the same carton through pickup and handoff',()=>{
    const a=state(0),b=state(1);
    const segments={A:{id:'A',length_m:10,path:[[2,0],[12,0]]}} as Record<string,LayoutConveyor>;
    const p={package_id:'P',route:['A'],route_index:0,current_conveyor_segment:null,conveyor_position:0,package_dimensions:[.6,.4,.5]} as Parcel;
    a.robots.R01={...a.robots.R01,position:[0,0,0],fsm:'PICKING',operation_duration_ticks:40,operation_elapsed_ticks:0};
    b.robots.R01={...a.robots.R01,operation_elapsed_ticks:40};
    const start=robotParcelPose({a,b,u:0,tick:0},p,b.robots.R01,segments);
    const held=robotParcelPose({a,b,u:1,tick:1},p,b.robots.R01,segments);
    expect(start.position).toEqual([.8,.8,0]);
    expect(held.position[0]).toBeCloseTo(.47);
    a.robots.R01={...a.robots.R01,fsm:'DELIVERING',operation_duration_ticks:30};
    b.robots.R01={...a.robots.R01,operation_elapsed_ticks:30};
    expect(robotParcelPose({a,b,u:0,tick:0},p,b.robots.R01,segments).position).toEqual(held.position);
    expect(robotParcelPose({a,b,u:1,tick:1},p,b.robots.R01,segments).position).toEqual([2,1.075,0]);
  });
  it.each([5,15,30,60,144])('uses the same timeline at %i FPS',fps=>{
    const stream=new SnapshotMotion();stream.reset(state(0),0);
    let nextTick=1;
    for(let frame=1;frame<=fps*2;frame++){
      const now=frame*1000/fps;
      while(nextTick*100<=now){stream.push(state(nextTick),nextTick*100);nextTick++;}
      const sample=stream.sample(now)!;
      expect(sample.tick).toBeLessThanOrEqual(sample.b.sim.tick);
    }
    const sample=stream.sample(2000)!;
    expect(sample.tick).toBeCloseTo(18.75);
    expect(robotPose(sample,state(20).robots.R01).position[0]).toBeCloseTo(1.875);
    expect(beltDistance(sample,'C')).toBeCloseTo(2.25);
  });
  it.each([.25,.5,1,2,4] as const)('scales only the common clock at %sx',speed=>{
    const stream=new SnapshotMotion();stream.reset(state(0,speed),0);
    for(let t=1;t<=20;t++)stream.push(state(t,speed),t*100/speed);
    expect(stream.sample(2000/speed)!.tick).toBeCloseTo(19-.25*speed);
  });
  it('freezes at the newest data through a delay without extrapolation or rewind',()=>{
    const stream=new SnapshotMotion();stream.reset(state(0),0);stream.push(state(1),100);
    expect(stream.sample(5000)!.tick).toBe(1);
    stream.push(state(2),5100);
    expect(stream.sample(5100)!.tick).toBe(1);
    expect(stream.sample(5300)!.tick).toBe(2);
  });
  it('clears old motion across pause, speed changes and reset',()=>{
    const stream=new SnapshotMotion();stream.reset(state(10),1000);stream.push(state(11),1100);
    const paused=state(11);paused.sim.mode='PAUSED';stream.push(paused,1150);
    expect(stream.sample(10000)!.tick).toBe(11);
    stream.push(state(11,.5),10100);stream.push(state(12,.5),10300);
    expect(stream.sample(10500)!.tick).toBeLessThanOrEqual(12);
    stream.reset(state(0),10600);
    expect(stream.sample(10600)!.tick).toBe(0);
  });
  it('follows received path vertices rather than cutting a corner',()=>{
    const a=state(0),b=state(4),path:[[number,number],[number,number]]=[[1,0],[1,1]];
    a.robots.R01={...a.robots.R01,position:[.5,0,.5],path,path_index:0};
    b.robots.R01={...b.robots.R01,position:[1.5,0,1.5],path,path_index:2,heading:Math.PI/2};
    expect(robotPose({a,b,u:.5,tick:2},b.robots.R01).position).toEqual([1.5,0,.5]);
    const replanned={...b,robots:{R01:{...b.robots.R01,path:[[8,8]] as [number,number][]}}};
    expect(robotPose({a,b:replanned,u:.5,tick:2},replanned.robots.R01).position).toEqual(a.robots.R01.position);
  });
  it('preserves parcel headway and follows conveyor junction arc distance',()=>{
    const segments={A:{id:'A',length_m:10,path:[[0,0],[10,0]]},B:{id:'B',length_m:10,path:[[10,0],[10,10]]}} as Record<string,LayoutConveyor>;
    const p={package_id:'P',route:['A','B'],route_index:0,current_conveyor_segment:'A',conveyor_position:9,status:'ON_CONVEYOR',package_dimensions:[.6,.4,.5]} as Parcel;
    const a=state(0),b=state(2);a.packages={P:p};b.packages={P:{...p,route_index:1,current_conveyor_segment:'B',conveyor_position:1}};
    const sample=parcelPose({a,b,u:.5,tick:1},b.packages.P,segments);
    expect(sample.position).toEqual([10,1.075,0]);
    a.packages.Q={...p,package_id:'Q',conveyor_position:7.6};b.packages.Q={...p,package_id:'Q',conveyor_position:9.6};
    for(const u of [0,.25,.5,.75,1]){
      const leader=parcelPose({a,b,u,tick:u*2},b.packages.P,segments).parcel;
      const follower=parcelPose({a,b,u,tick:u*2},b.packages.Q,segments).parcel;
      expect((leader.current_conveyor_segment==='B'?10:0)+leader.conveyor_position-follower.conveyor_position).toBeCloseTo(1.4);
    }
  });
});
