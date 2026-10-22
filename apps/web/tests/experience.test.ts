import { describe,it,expect } from 'vitest';
import * as THREE from 'three';
import { frameObject,indexObjects,searchObjects } from '../src/components/scene/experience';
import { layout,useStore } from '../src/state/store';
describe('camera framing and selection contracts',()=>{
  for(const mode of ['orbit','top','isometric'] as const)for(const aspect of [.5,1.7])it(`fits all warehouse corners: ${mode}, ${aspect}`,()=>{
    const center=[90,7,60],size=[180,14,120];
    const camera=new THREE.PerspectiveCamera(42,aspect,.08,1500);
    camera.position.fromArray(frameObject(center,size,aspect,mode));camera.lookAt(new THREE.Vector3(...center));camera.updateMatrixWorld();
    for(const x of [0,180])for(const y of [0,14])for(const z of [0,120]){const point=new THREE.Vector3(x,y,z).project(camera);expect(Math.abs(point.x)).toBeLessThan(1);expect(Math.abs(point.y)).toBeLessThan(1);}
  });
  it('uses rack aliases and exact ID ranking, bounded results',()=>{
    const objects=indexObjects(layout),rack=objects.find(o=>o.kind==='rack'&&o.aliases.length)!;
    expect(searchObjects(objects,{robots:{}},rack.aliases[0])[0].id).toBe(rack.id);
    expect(searchObjects(objects,{robots:{}},'RACK').length).toBeLessThanOrEqual(12);
    expect(searchObjects(objects,{robots:{}},'missing-id')).toEqual([]);
    expect(searchObjects(objects,{robots:{}},'  ')).toEqual([]);
  });
  it('selection is exclusive and leaving robot inspection exits follow mode',()=>{
    const s=useStore.getState();s.select('R01');s.setCameraMode('first');s.inspect({kind:'rack',id:'rack-test'});
    expect(useStore.getState().selectedRobot).toBeNull();expect(useStore.getState().cameraMode).toBe('orbit');
    s.select('R02');expect(useStore.getState().selection).toEqual({kind:'robot',id:'R02'});s.selectLift('L01');expect(useStore.getState().selection).toBeNull();
    s.inspect(null);
  });
  it('layer toggles do not alter simulation state',()=>{
    const before=useStore.getState().twin,s=useStore.getState(),was=s.layers.obstacles;s.toggleLayer('obstacles');
    expect(useStore.getState().layers.obstacles).toBe(!was);expect(useStore.getState().twin).toBe(before);s.toggleLayer('obstacles');
  });
  it('static objects match physical rack bounds and elevations',()=>{
    const objects=indexObjects(layout);for(const r of layout.racks){const o=objects.find(o=>o.kind==='rack'&&o.id===r.id)!;expect(o.center[0]-o.size[0]/2).toBe(r.position[0]);expect(o.center[2]-o.size[2]/2).toBe(r.position[2]);expect(o.floor).toBe(r.floor??1);}
  });
});
