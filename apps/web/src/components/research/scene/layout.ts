import type { Carrier, ResearchSnapshot } from '../../../../../../packages/contracts/research';
import type { Selection } from '../presentation';
export type Point = [number, number, number];
export const packingPosition = (state: ResearchSnapshot, index: number): Point => [state.config.belt_length_m + 11, 0, index * 4 - 2];
export const consolidationSlot = (state: ResearchSnapshot, index: number): Point => [state.config.belt_length_m + 2.3 + index % 4 * 1.25, .95, -2.7 + Math.floor(index / 4) * 1.25];
export const dispatchSlot = (state: ResearchSnapshot, index: number): Point => [state.config.belt_length_m + 17 + index % 3 * 1.3, .7, -3 + Math.floor(index / 3) * 1.2];
/** Buffer slots are schematic: core owns the containing resource, not a position within it. */
export function carrierPosition(carrier: Carrier, state: ResearchSnapshot): Point {
    if (carrier.state === 'ON_BELT') return [carrier.position_m, 1.24, 0];
    if (carrier.state === 'LOCAL_BUFFER') {
        const zone = state.config.zones.find(z => z.id === carrier.zone_id)!;
        const siblings = state.carriers.filter(c => c.zone_id === carrier.zone_id && c.state === 'LOCAL_BUFFER');
        const index = siblings.findIndex(c => c.id === carrier.id);
        return [zone.entry_m + index % 4 * 1.15, 1.1, -1.75 - Math.floor(index / 4) * 1.1];
    }
    if (carrier.state === 'CONSUMED') {
        const index = Math.max(0, state.packages.slice(-24).findIndex(p => p.order_id === carrier.order_id));
        return dispatchSlot(state, index);
    }
    const ordered = Object.keys(state.consolidation.orders).flatMap(id => state.orders.find(o => o.id === id)?.item_ids ?? []);
    return consolidationSlot(state, Math.max(0, ordered.indexOf(carrier.item_id)));
}
export function focusPoint(selection: Selection | null, state: ResearchSnapshot): Point {
    const c = state.config, middle: Point = [(c.belt_length_m + 16) / 2, 0, -3];
    if (!selection) return middle;
    const { kind, id } = selection;
    if (kind === 'robot') return state.robots.find(r => r.id === id)?.position ?? middle;
    if (kind === 'carrier') { const p = state.carriers.find(p => p.id === id); return p ? carrierPosition(p, state) : middle; }
    if (kind === 'zone') { const z = c.zones.find(z => z.id === id); return z ? [z.entry_m + (z.robots - 1) * .75, 0, -3 - z.pick_distance_m / 2] : middle; }
    if (kind === 'packing') return packingPosition(state, Math.max(0, state.packing.findIndex(p => p.id === id)));
    if (kind === 'belt') return [c.belt_length_m / 2, 0, 0];
    if (kind === 'consolidation') return [c.belt_length_m + 4, 0, 0];
    if (kind === 'dispatch') return [c.belt_length_m + 18, 0, 1];
    const order = state.orders.find(o => o.id === id);
    if (order?.status === 'COMPLETED') return dispatchSlot(state, Math.max(0, state.packages.slice(-24).findIndex(p => p.order_id === id)));
    const station = state.packing.findIndex(p => p.order_id === id);
    if (station >= 0) return packingPosition(state, station);
    const points = state.items.filter(i => i.order_id === id).map(i => {
        const robot = state.robots.find(r => r.id === i.location); if (robot) return robot.position;
        const carrier = state.carriers.find(p => p.item_id === i.id); if (carrier) return carrierPosition(carrier, state);
        const z = c.zones.find(z => z.id === i.zone_id)!; return [z.entry_m, 0, -3 - z.pick_distance_m] as Point;
    });
    return points.length ? points.reduce((a, b) => a.map((v, i) => v + b[i] / points.length) as Point, [0, 0, 0] as Point) : middle;
}
/** Clamp orbit cameras outside rack volumes, including when dollying during focus. */
export function safeCameraPosition(position: Point, state: ResearchSnapshot, racks: boolean): Point {
    const result = [...position] as Point; result[1] = Math.max(1.8, result[1]);
    if (racks) for (const z of state.config.zones) {
        const center = z.entry_m + (z.robots - 1) * .75, rackZ = -4.6 - z.pick_distance_m;
        if (Math.abs(result[0] - center) < Math.max(3.5, z.robots * .85) && Math.abs(result[2] - rackZ) < 1.6 && result[1] < 5.3) result[1] = 5.3;
    }
    result[0] = Math.max(-15, Math.min(state.config.belt_length_m + 35, result[0]));
    result[2] = Math.max(-60, Math.min(70, result[2]));
    return result;
}
