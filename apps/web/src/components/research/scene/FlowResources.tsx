import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { ResearchSnapshot } from '../../../../../../packages/contracts/research';
import type { SceneLayers, Selection } from '../presentation';
import { fmt } from '../presentation';
import { Block, FloorArrow, FloorText, InstancedBlocks, SceneLabel, Selectable } from './primitives';
import { consolidationSlot, dispatchSlot, packingPosition, type Point } from './layout';
import { palette, zoneColor } from './theme';
export function FlowResources({ state, layers, selection, orderId }: { state: ResearchSnapshot; layers: SceneLayers; selection: Selection | null; orderId: string | null }) {
    const c = state.config;
    const rollers = useMemo(() => Array.from({ length: Math.ceil(c.belt_length_m / .45) }, (_, i) => [i * .45, 1.005, 0] as Point), [c.belt_length_m]);
    const future = state.reservations.filter(r => r.entry_s > state.time_s && (!orderId || r.order_id === orderId));
    const slots = Object.keys(state.consolidation.orders).flatMap(id => state.orders.find(o => o.id === id)?.item_ids ?? []);
    return <>
        <group position={[c.belt_length_m / 2, 0, 0]}><Selectable target={{ kind: 'belt', id: 'BELT' }}><Block at={[0, .79, 0]} size={[c.belt_length_m + 1, .36, 1.25]} color={state.belt.stopped ? palette.error : palette.belt}/><Block at={[0, .97, -.72]} size={[c.belt_length_m + 1, .12, .1]} color={palette.rail}/><Block at={[0, .97, .72]} size={[c.belt_length_m + 1, .12, .1]} color={palette.rail}/></Selectable></group>
        <InstancedBlocks positions={rollers} size={[.14, .06, 1.14]} color={palette.rail}/>
        {Array.from({ length: Math.floor(c.belt_length_m / 4) }, (_, i) => <group key={i}><Block at={[i * 4 + 1, .38, 0]} size={[.15, .76, 1.1]} color={palette.steel}/><FloorArrow at={[i * 4 + 2, .04, 2]} color={state.belt.stopped ? palette.error : palette.steel}/></group>)}
        {c.zones.map((z, i) => {
            const entries = future.filter(r => r.zone_id === z.id).slice(0, 3);
            const waiting = state.carriers.filter(p => p.zone_id === z.id && p.state === 'LOCAL_BUFFER').length;
            return <group key={z.id}>
                <Block at={[z.entry_m, .82, -.9]} size={[1, .25, .9]} color={zoneColor(i)}/><Block at={[z.entry_m - .7, 1.15, -1]} size={[.1, 2.3, .1]} color={palette.steel}/><Block at={[z.entry_m - .7, 2.35, -1]} size={[.2, .22, .2]} color={state.belt.stopped ? palette.error : palette.good}/>
                <FloorText text={`${z.id} GİRİŞ →`} at={[z.entry_m + 1.5, .04, 3.2]} width={4}/>
                {layers.labels && state.belt.stopped && waiting > 0 && <SceneLabel at={[z.entry_m + 1.5, 2.5, -1.7]} target={{ kind: 'zone', id: z.id }}><b>DURDU</b><span>{waiting} taşıyıcı bekliyor</span></SceneLabel>}
                {layers.reservations && entries.map((r, index) => <group key={r.task_id} position={[z.entry_m, 2.5 + index * .9, 0]}>
                    <Line points={[[-.48, 0, -.4], [.48, 0, -.4], [.48, 0, .4], [-.48, 0, .4], [-.48, 0, -.4]]} dashed dashSize={.16} gapSize={.1} color={palette.ghost} lineWidth={1.7}/>
                    <SceneLabel at={[1.7, .15, 0]} target={{ kind: 'order', id: r.order_id }}><b>PLAN · {fmt(r.entry_s)} s</b><span>{r.order_id}</span></SceneLabel>
                </group>)}
            </group>;
        })}
        {layers.labels && <SceneLabel at={[c.belt_length_m / 2, .2, 4.6]} target={{ kind: 'belt', id: 'BELT' }} active={selection?.kind === 'belt'}><b>ORTAK KONVEYÖR</b><span>{state.belt.stopped ? 'DURDU' : `${c.belt_speed_mps} m/s`} · {state.carriers.filter(p => p.state === 'ON_BELT').length} taşıyıcı</span></SceneLabel>}
        <group position={[c.belt_length_m + 4.2, 0, 0]}><Selectable target={{ kind: 'consolidation', id: 'CONSOLIDATION' }}><Block at={[0, .02, 0]} size={[6.8, .04, Math.max(6.8, Math.ceil(c.consolidation_slots / 4) * 1.25 + 1)]} color={palette.apron}/></Selectable></group>
        {Array.from({ length: c.consolidation_slots }, (_, i) => { const p = consolidationSlot(state, i), item = state.items.find(v => v.id === slots[i]); return <group key={i}><Block at={[p[0], .65, p[2]]} size={[1.14, .16, 1.13]} color={item?.order_id === orderId ? palette.selection : slots[i] ? palette.rail : palette.floor}/>{slots[i] && !['CONSOLIDATION', 'PACKAGE'].includes(item?.location ?? '') && <mesh position={[p[0], .76, p[2]]} rotation-x={-Math.PI / 2}><ringGeometry args={[.28, .32, 20]}/><meshBasicMaterial color={palette.ghost}/></mesh>}</group>; })}
        {layers.labels && <SceneLabel at={[c.belt_length_m + 4.2, 3.8, -3.7]} target={{ kind: 'consolidation', id: 'CONSOLIDATION' }} active={selection?.kind === 'consolidation'}><b>BİRLEŞTİRME</b><span>{state.consolidation.reserved_slots}/{c.consolidation_slots} yuva ayrıldı</span></SceneLabel>}
        <FloorText text="01 / BİRLEŞTİRME" at={[c.belt_length_m + 4.2, .05, 4.5]} width={6}/>
        {state.packing.map((p, i) => <group key={p.id} position={packingPosition(state, i)}><Selectable target={{ kind: 'packing', id: p.id }}>
            <Block at={[0, .8, 0]} size={[3.1, .24, 2.4]} color={p.order_id === orderId || selection?.id === p.id ? palette.selection : palette.steel}/>
            {[-1.3, 1.3].map(x => <Block key={x} at={[x, .4, 0]} size={[.13, .8, 2]} color={palette.rail}/>)}
            <Block at={[0, 1.8, -1]} size={[3.1, 2.3, .18]} color={palette.rail}/><Block at={[0, 2, -.86]} size={[1.6, .7, .07]} color={p.failed_until_s != null ? palette.error : p.order_id ? palette.good : palette.dark}/>
            <Block at={[1.2, 2.1, -.7]} size={[.16, .25, .16]} color={p.failed_until_s != null ? palette.error : palette.good}/>
            {layers.labels && <SceneLabel at={[0, 3.4, 0]} target={{ kind: 'packing', id: p.id }} active={selection?.id === p.id}><b>{p.id}</b><span>{p.failed_until_s != null ? 'KESİNTİ' : p.order_id ?? 'BOŞ · HAZIR'}</span></SceneLabel>}
        </Selectable></group>)}
        <FloorText text="02 / PAKETLEME" at={[c.belt_length_m + 11, .05, Math.max(5, state.packing.length * 4 - 1)]} width={6}/>
        <group position={[c.belt_length_m + 18.3, 0, 1]}><Selectable target={{ kind: 'dispatch', id: 'DISPATCH' }}><Block at={[0, .045, 0]} size={[5.5, .06, 11]} color={palette.apron}/></Selectable></group>
        {state.packages.slice(-24).map((p, i) => <group key={p.id} position={dispatchSlot(state, i)}><Selectable target={{ kind: 'order', id: p.order_id }}><Block at={[0, 0, 0]} size={[1.05, 1.1, .95]} color={p.order_id === orderId ? palette.selection : palette.carton}/><Block at={[0, .56, 0]} size={[.15, .018, .98]} color={palette.label} shadow={false}/><Block at={[0, 0, .48]} size={[.43, .28, .01]} color={palette.label} shadow={false}/></Selectable></group>)}
        {layers.labels && <SceneLabel at={[c.belt_length_m + 18.3, 3.8, -3.7]} target={{ kind: 'dispatch', id: 'DISPATCH' }} active={selection?.kind === 'dispatch'}><b>SEVKİYATA HAZIR</b><span>{state.packages.length} müşteri paketi</span></SceneLabel>}
        <FloorText text="03 / ÇIKIŞ" at={[c.belt_length_m + 18.3, .1, 7.7]} width={5}/>
    </>;
}
