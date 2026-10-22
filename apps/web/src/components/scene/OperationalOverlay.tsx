import { useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { layout, useStore } from '../../state/store';
import { useWarehouseOperations } from '../../state/warehouseOperations';
import { presentation, parcelPose } from '../../simulation/presentation';
const segments = Object.fromEntries(layout.conveyors.map(c=>[c.id,c]));
import { stationStatus } from '../warehouse/operations';
import { parcelColor } from './parcelPresentation';
import { ResourceLabel } from './ResourceLabel';
const geometry = new THREE.BoxGeometry(1, 1, 1);
/** Operational annotations on the existing geometry. Never writes simulation state. */
export function OperationalOverlay() {
    const twin = useStore(s => s.twin), selection = useStore(s => s.selection), labels = useStore(s => s.showLabels), mode = useStore(s => s.cameraMode);
    const data = useWarehouseOperations(s => s.data), flow = useWarehouseOperations(s => s.flowVisible), gaps = useWarehouseOperations(s => s.gapVisible);
    const selectedOrder = selection?.kind === 'order' ? data?.orders.find(o => o.id === selection.id) : null;
    const parcels = Object.values(twin.packages ?? {});
    const show = labels && flow && !['walk', 'first', 'third'].includes(mode);
    return <group>
        {Object.values(layout.conveyor_network?.induction_points ?? {}).map(entry => {
            const zone = twin.conveyor_system?.zones[entry.zone_id], segment = twin.conveyors[entry.segment_id];
            const conveyor = layout.conveyors.find(c => c.id === entry.segment_id); if (!conveyor) return null;
            const p = conveyor.path[0];
            return show && <ResourceLabel key={entry.id} position={[p[0], 3, p[1]]} selected={selection?.kind === 'zone' && selection.id === entry.zone_id}><button className={`ww-operational-label ${segment?.status !== 'RUNNING' ? 'stopped' : ''}`} onClick={() => useStore.getState().inspect({ kind: 'zone', id: entry.zone_id })}><strong>{entry.zone_id.replace('ZONE_', '')} · KONVEYÖR GİRİŞİ</strong><small>{zone?.induction_queue.length ?? 0} bekleyen · {entry.capacity} eşzamanlı aktarım</small><small>{segment?.status === 'RUNNING' ? 'Bant açık' : segment?.status ?? 'Veri bekleniyor'}</small></button></ResourceLabel>;
        })}
        {layout.stations.filter(s => s.kind === 'PACKING').map(station => {
            const order = data?.orders.find(o => o.packing_station === station.id && o.status === 'packing' && o.packing_until_tick != null);
            const exit = twin.conveyor_system?.unloading_points[station.id];
            const x = (station.rect[0] + station.rect[2]) / 2, z = (station.rect[1] + station.rect[3]) / 2;
            return <group key={station.id}>{show && <ResourceLabel position={[x, 4, z]} maxDistance={55} selected={selection?.kind === 'station' && selection.id === station.id || selectedOrder?.packing_station === station.id}><button className={`ww-operational-label ${order ? 'active' : ''} ${exit?.enabled === false ? 'stopped' : ''}`} onClick={() => useStore.getState().inspect({ kind: 'station', id: station.id })}><strong>{station.id} · {stationStatus(station.id, twin, data?.orders).toLocaleUpperCase('tr')}</strong><small>{exit?.items.length ?? 0}/{exit?.capacity ?? '—'} taşıyıcı · {order ? `${Math.max(0, (order.packing_until_tick! - twin.sim.tick) * twin.sim.tick_ms / 1000).toFixed(1)} s kaldı` : 'İşlem yok'}</small></button></ResourceLabel>}
                {order && <mesh position={[x, 1.8, z]} rotation-x={-Math.PI / 2} raycast={() => {}}><ringGeometry args={[1.4, 1.55, 32]}/><meshBasicMaterial color="#8cd2b3" transparent opacity={.85}/></mesh>}
            </group>;
        })}
        <StationContents/>
        {gaps && <BeltSpacing/>}
        {selectedOrder && <>{layout.zones.filter(z => parcels.some(p => p.order_id === selectedOrder.id && p.source_zone === z.id)).map(z => <Line key={z.id} points={[...z.polygon, z.polygon[0]].map(p => [p[0], .15, p[1]] as [number, number, number])} color="#83dcd5" lineWidth={3} raycast={() => {}}/>)}{layout.racks.filter(r => selectedOrder.items.some(i => i.rack_id === r.id || layout.locations.some(l => l.id === i.rack_id && l.rack_id === r.id))).map(r => <mesh key={r.id} position={[r.position[0] + r.size[0] / 2, r.position[1] + r.size[1] / 2, r.position[2] + r.size[2] / 2]} scale={r.size.map(v => v + .2) as [number, number, number]} geometry={geometry} raycast={() => {}} dispose={null}><meshBasicMaterial color="#83dcd5" wireframe/></mesh>)}</>}
    </group>;
}
function StationContents() {
    const twin = useStore(s => s.twin), selection = useStore(s => s.selection);
    const ref = useRef<THREE.InstancedMesh>(null!);
    const contents = Object.entries(twin.conveyor_system?.unloading_points ?? {}).flatMap(([id, exit]) => {
        const station = layout.stations.find(s => s.id === id), loc = layout.locations.find(l => l.id === id);
        const center = station ? [(station.rect[0] + station.rect[2]) / 2, (station.rect[1] + station.rect[3]) / 2] : loc?.access_point;
        if (!center) return [];
        const columns = station ? Math.max(1, Math.floor((station.rect[2] - station.rect[0] - .5) / .8)) : 4;
        return exit.items.map((pid, i) => ({ id: pid, position: [center[0] + (i % columns - (columns - 1) / 2) * .75, 1.35 + Math.floor(i / (columns * 2)) * .45, center[1] + (Math.floor(i / columns) % 2 - .5) * .65] as [number, number, number] }));
    });
    const capacity = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, contents.length))));
    const object = useMemo(() => new THREE.Object3D(), []), color = useMemo(() => new THREE.Color(), []);
    useFrame(() => { if (!ref.current) return; contents.forEach((v, i) => { const frame=presentation.sample(); const sample=frame && (frame.u<1?frame.a:frame.b); const p = sample?.packages?.[v.id] ?? twin.packages?.[v.id]; object.position.set(...v.position); object.scale.set(p?.status==='DELIVERED'?.57:0, .4, .47); object.updateMatrix(); ref.current.setMatrixAt(i, object.matrix); color.set(parcelColor(p, selection?.id === v.id || selection?.kind === 'order' && p?.order_id === selection.id)); ref.current.setColorAt(i, color); }); ref.current.count = contents.length; ref.current.instanceMatrix.needsUpdate = true; if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true; });
    return <instancedMesh key={capacity} ref={ref} args={[geometry, undefined, capacity]} dispose={null} frustumCulled={false} castShadow onClick={e => { if (e.instanceId == null) return; e.stopPropagation(); useStore.getState().inspect({ kind: 'package', id: contents[e.instanceId].id }); }}><meshStandardMaterial roughness={.9}/></instancedMesh>;
}
function BeltSpacing() {
    const parcels = useStore(s => s.twin.packages), ref = useRef<THREE.InstancedMesh>(null!);
    const items = Object.values(parcels ?? {}).filter(p => p.status === 'ON_CONVEYOR');
    const capacity = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, items.length)))), obj = useMemo(() => new THREE.Object3D(), []);
    useFrame(() => { if (!ref.current) return; items.forEach((p, i) => { const c = layout.conveyors.find(c => c.id === p.current_conveyor_segment); if (!c) return; const a = c.path[0], b = c.path[c.path.length - 1]; obj.position.set(...parcelPose(presentation.sample(),p,segments).position); obj.position.y = .91; obj.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); obj.scale.set(c.pitch_m ?? p.package_dimensions[0], .05, c.width + .15); obj.updateMatrix(); ref.current.setMatrixAt(i, obj.matrix); }); ref.current.count = items.length; ref.current.instanceMatrix.needsUpdate = true; });
    return <instancedMesh key={capacity} ref={ref} args={[geometry, undefined, capacity]} dispose={null} frustumCulled={false} raycast={() => {}}><meshBasicMaterial color="#a5ddd3" wireframe/></instancedMesh>;
}
