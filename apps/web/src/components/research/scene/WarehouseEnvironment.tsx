import { memo, useMemo } from 'react';
import type { ResearchSnapshot } from '../../../../../../packages/contracts/research';
import type { SceneLayers, Selection } from '../presentation';
import { ResearchRack } from '../../../assets/models/ResearchRack';
import { palette, zoneColor } from './theme';
import { Block, FloorArrow, FloorText, InstancedBlocks, SceneLabel, Selectable } from './primitives';
import type { Point } from './layout';
export const WarehouseEnvironment = memo(function WarehouseEnvironment({ state, layers, selection, orderId }: { state: ResearchSnapshot; layers: SceneLayers; selection: Selection | null; orderId: string | null }) {
    const c = state.config;
    const depth = Math.max(20, ...c.zones.map(z => z.pick_distance_m + 12));
    const seams = useMemo(() => Array.from({ length: Math.ceil((c.belt_length_m + 28) / 4) }, (_, i) => [-6 + i * 4, .005, -3] as Point), [c.belt_length_m]);
    return <><color attach="background" args={[palette.background]}/><ambientLight intensity={1.25}/><hemisphereLight args={['#f7fafb', '#a5b8af', 1.7]}/><directionalLight position={[15, 45, 20]} intensity={2.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-75} shadow-camera-right={75} shadow-camera-top={50} shadow-camera-bottom={-50} shadow-normalBias={.04}/>
        <Block at={[(c.belt_length_m + 14) / 2, -.23, -3]} size={[c.belt_length_m + 30, .4, depth + 14]} color={palette.floor} shadow={false}/>
        <InstancedBlocks positions={seams} size={[.018, .006, depth + 13]} color={palette.grid}/>
        <Block at={[(c.belt_length_m + 14) / 2, .007, 6]} size={[c.belt_length_m + 29, .01, 2.7]} color={palette.apron} shadow={false}/>
        <FloorText text="ORTAK MALZEME AKIŞI" at={[c.belt_length_m / 2, .026, 6]} width={13}/>
        {c.zones.map((z, i) => {
            const center = z.entry_m + (z.robots - 1) * .75, width = Math.max(8, z.robots * 1.5 + 3), selected = selection?.kind === 'zone' && selection.id === z.id || !!orderId && state.items.some(item => item.order_id === orderId && item.zone_id === z.id);
            const obs = state.zones.find(v => v.id === z.id);
            return <group key={z.id}><group position={[center, 0, -4 - z.pick_distance_m / 2]}><Selectable target={{ kind: 'zone', id: z.id }}><mesh rotation-x={-Math.PI / 2} position={[0, .018, 0]}><planeGeometry args={[width, z.pick_distance_m + 5.6]}/><meshStandardMaterial color={zoneColor(i)} transparent opacity={selected ? .32 : .13} depthWrite={false}/></mesh></Selectable></group>
                {[-width / 2, width / 2].map(edge => <Block key={edge} at={[center + edge, .027, -4 - z.pick_distance_m / 2]} size={[.07, .012, z.pick_distance_m + 5.6]} color={selected ? palette.selection : zoneColor(i)} shadow={false}/>)}
                {layers.racks && <ResearchRack x={center} z={-4.6 - z.pick_distance_m} width={Math.max(5, z.robots * 1.5 + 1)}/>}
                {Array.from({ length: z.robots }, (_, lane) => <group key={lane}><Block at={[z.entry_m + lane * 1.5, .03, -3 - z.pick_distance_m / 2]} size={[.035, .01, z.pick_distance_m]} color={palette.line} shadow={false}/><FloorArrow at={[z.entry_m + lane * 1.5, .04, -4.5]} rotation={Math.PI / 2}/></group>)}
                <FloorText text={`${z.id} / HAZIRLAMA`} at={[center, .036, -7.7 - z.pick_distance_m]} color={zoneColor(i)} width={7}/>
                {layers.labels && <SceneLabel at={[center, 5.7, -4.6 - z.pick_distance_m]} target={{ kind: 'zone', id: z.id }} active={selected}><i style={{ background: zoneColor(i) }}/><b>{z.id}</b><span>{obs?.queued ?? 0} görev sırada</span></SceneLabel>}
                {Array.from({ length: z.buffer_slots }, (_, slot) => <Block key={slot} at={[z.entry_m + slot % 4 * 1.15, .76, -1.75 - Math.floor(slot / 4) * 1.1]} size={[1.05, .14, .95]} color={slot < (obs?.local_claims ?? 0) ? zoneColor(i) : palette.rail}/>) }
                <FloorText text={`TAMPON ${obs?.buffer_occupancy ?? 0}/${z.buffer_slots}`} at={[center + 1, .03, -2.8]} width={4}/>
            </group>;
        })}
    </>;
});
