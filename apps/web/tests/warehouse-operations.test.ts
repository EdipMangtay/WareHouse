import { describe, expect, it } from 'vitest';
import { orderParcels, orderStage, parcelWait, selectedOrderId, focusSelection, stationStatus } from '../src/components/warehouse/operations';
import type { WarehouseOrder } from '../src/state/warehouseOperations';
import type { RobotState } from '../src/schema/twin_state';
import type { Parcel } from '../src/schema/conveyor';
import { layout, useStore } from '../src/state/store';
import { useWarehouseOperations } from '../src/state/warehouseOperations';
const order = { id: 'order-1', tracking_code: 'WT-TEST', status: 'picking', task_ids: ['task-a', 'task-b'], items: [], packing_station: 'PACK-01' } as WarehouseOrder;
function parcel(id: string, status: Parcel['status']): Parcel {
    return { package_id: id, order_id: order.id, task_id: `task-${id}`, source_zone: `ZONE_${id.toUpperCase()}`, destination_station: 'PACK-01', routing_destination: 'PACK-01', current_location: 'IND-A', current_conveyor_segment: null, conveyor_position: 0, package_dimensions: [.5, .4, .5], status, created_at: 0, loaded_at: null, delivered_at: null, robot_id: null, induction_station: 'IND-A', route: ['IND-A'], route_index: 0, estimated_remaining_s: null, timeline: [] };
}
const snapshot = () => {
    const twin = structuredClone(useStore.getState().twin);
    twin.robots = { R01: { id: 'R01', status: 'ACTIVE', current_task_id: null, perception: { state: 'CLEAR', ahead_m: 4 } } as RobotState };
    return twin;
};
describe('existing warehouse: read-only customer order projection', () => {
    it('keeps cross-zone carriers under one order and never completes an absent component', () => {
        const twin = snapshot(); twin.packages = { a: parcel('a', 'DELIVERED'), b: parcel('b', 'AWAITING_PICKUP'), other: { ...parcel('x', 'DELIVERED'), order_id: 'other' } };
        const before = JSON.stringify(twin);
        expect(orderParcels(order, twin).map(p => p.package_id)).toEqual(['a', 'b']);
        expect(orderStage(order, twin)).toBe('Bileşenler bekleniyor');
        twin.packages.b.status = 'DELIVERED';
        expect(orderStage(order, twin)).toBe('Paketleme kabulü bekleniyor');
        twin.packages.b.status = 'AWAITING_PICKUP';
        expect(JSON.stringify(twin)).toBe(before);
        expect(order.status).toBe('picking');
    });
    it('distinguishes queue, in-progress packing, and outbound after packing using authoritative status', () => {
        const twin = snapshot(); twin.sim.tick = 1000;
        expect(orderStage({ ...order, status: 'packing', packing_until_tick: null }, twin)).toBe('Paketleme sırası');
        expect(orderStage({ ...order, status: 'packing', packing_until_tick: 20 }, twin)).toBe('Paketleniyor');
        expect(orderStage({ ...order, status: 'loading' }, twin)).toBe('Çıkışa taşınıyor');
        expect(orderStage({ ...order, status: 'ready' }, twin)).toBe('Sevkiyata hazır');
    });
    it('uses live carrier states before the cached order response', () => {
        const cached = { ...order, parcels: [parcel('a', 'AWAITING_PICKUP')] }, twin = snapshot();
        twin.packages = { a: parcel('a', 'ON_CONVEYOR') };
        expect(orderStage(cached, twin)).toBe('Konveyörde');
        twin.packages = {};
        expect(orderStage(cached, twin)).toBe('Hazırlanıyor');
    });
    it('does not turn unknown admission reasons into fake reservations', () => {
        const twin = snapshot(), p = parcel('a', 'WAITING_INDUCTION');
        twin.conveyors = {};
        expect(parcelWait(p, twin)).toContain('sağlanmıyor');
        twin.packages = { a: p, b: parcel('b', 'LOADING') };
        expect(orderStage(order, twin)).toBe('Konveyör bekliyor');
    });
    it('does not attribute a former robot fault to a delivered carrier', () => {
        const twin = snapshot(), robot = Object.values(twin.robots)[0];
        robot.status = 'ERROR';
        const p = { ...parcel('a', 'ON_ROBOT'), robot_id: robot.id };
        expect(parcelWait(p, twin)).toContain('arızalı');
        expect(parcelWait({ ...p, status: 'DELIVERED' }, twin)).toBeNull();
        robot.perception.state = 'STOPPED'; robot.perception.ahead_m = 1.2;
        expect(parcelWait(p, twin)).toContain('engel');
    });
    it('resolves a robot or carrier selection to the same customer order', () => {
        const twin = snapshot(), robot = Object.values(twin.robots)[0];
        robot.current_task_id = 'task-b'; twin.packages = { a: parcel('a', 'ON_ROBOT') };
        expect(selectedOrderId({ kind: 'robot', id: robot.id }, twin, [order])).toBe(order.id);
        expect(selectedOrderId({ kind: 'package', id: 'a' }, twin, [order])).toBe(order.id);
        robot.current_task_id = 'unrelated';
        expect(selectedOrderId({ kind: 'robot', id: robot.id }, twin, [order])).toBeNull();
    });
    it('focuses the existing physical zone and preserves authoritative simulation state', () => {
        const s = useStore.getState(), twin = s.twin, zone = layout.zones[0];
        s.inspect({ kind: 'zone', id: zone.id });
        focusSelection({ kind: 'zone', id: zone.id });
        expect(useStore.getState().selection).toEqual({ kind: 'zone', id: zone.id });
        expect(useStore.getState().focusTarget?.[0]).toBe((Math.min(...zone.polygon.map(p => p[0])) + Math.max(...zone.polygon.map(p => p[0]))) / 2);
        useWarehouseOperations.getState().toggleRacks();
        expect(useStore.getState().twin).toBe(twin);
        useWarehouseOperations.getState().toggleRacks(); s.inspect(null);
    });
});

it('shows a partially assembled order as waiting, separately from packing', () => {
    const twin = snapshot();
    twin.conveyor_system = { unloading_points: { 'PACK-01': { capacity: 4, enabled: true, items: ['a'], reservations: { 'order-1': 4 } } } } as typeof twin.conveyor_system;
    expect(stationStatus('PACK-01', twin, [order])).toBe('Birleştirme bekliyor');
    expect(stationStatus('PACK-01', twin, [{ ...order, status: 'packing', packing_until_tick: 25 }])).toBe('Paketleniyor');
    expect(stationStatus('PACK-01', twin, [{ ...order, status: 'packing', packing_until_tick: null }])).toBe('Paketleme sırası');
    twin.conveyor_system!.unloading_points['PACK-01'].enabled = false;
    expect(stationStatus('PACK-01', twin, [order])).toBe('Kabul kapalı');
    expect(stationStatus('unknown', twin, [order])).toBe('Kabul verisi bekleniyor');
});
