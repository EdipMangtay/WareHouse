import type { TwinState } from '../../schema/twin_state';
import type { Parcel } from '../../schema/conveyor';
import type { WarehouseOrder } from '../../state/warehouseOperations';
import { layout, useStore } from '../../state/store';
import { indexObjects, type SceneSelection } from '../scene/experience';
import { parcelPosition } from '../scene/ConveyorParcels';
export const OBJECTS = indexObjects(layout);
export const ROBOT_STATUS: Record<string, string> = { ACTIVE: 'Görevde', IDLE: 'Hazır', CHARGING: 'Şarj oluyor', WARNING: 'Uyarı', ERROR: 'Arızalı', OFFLINE: 'Çevrimdışı' };
export const FSM: Record<string, string> = { IDLE: 'Görev bekliyor', TASK_ASSIGNED: 'Görev atandı', NAVIGATING: 'Ürüne ilerliyor', PICKING: 'Raftan alıyor', TRANSPORTING: 'Ürünü taşıyor', DELIVERING: 'Aktarım yapıyor', COMPLETED: 'Görev tamamlandı', OBSTACLE_DETECTED: 'Engel nedeniyle bekliyor', REPLANNING: 'Rota yeniden hesaplanıyor', LOW_BATTERY: 'Batarya düşük', TASK_TRANSFER: 'Görev aktarılıyor', GOING_TO_CHARGE: 'Şarja gidiyor', CHARGING: 'Şarj oluyor', OFFLINE: 'Çevrimdışı', ERROR: 'Arızalı' };
export const STATUS: Record<string, string> = { received: 'Kuyrukta', picking: 'Hazırlanıyor', packing: 'Paketleme', loading: 'Çıkışa taşınıyor', ready: 'Sevkiyata hazır' };
export const fmt = (n: number | null | undefined, digits = 1) => n == null ? '—' : n.toLocaleString('tr-TR', { maximumFractionDigits: digits });
export const simSeconds = (tick: number, twin: TwinState) => tick * twin.sim.tick_ms / 1000;
export function stationStatus(id: string, twin: TwinState, orders?: WarehouseOrder[]) {
    const exit = twin.conveyor_system?.unloading_points[id];
    if (!exit) return 'Kabul verisi bekleniyor';
    if (!exit.enabled) return 'Kabul kapalı';
    if (!orders) return 'Sipariş verisi bekleniyor';
    const assigned = orders.filter(o => o.packing_station === id);
    if (assigned.some(o => o.status === 'packing' && o.packing_until_tick != null)) return 'Paketleniyor';
    if (assigned.some(o => o.status === 'packing')) return 'Paketleme sırası';
    if (assigned.some(o => o.status === 'picking') || exit.items.length) return 'Birleştirme bekliyor';
    return 'Boş · kabul açık';
}
export function orderParcels(order: WarehouseOrder, twin: TwinState): Parcel[] {
    const live = Object.values(twin.packages ?? {}).filter(p => p.order_id === order.id);
    return live.length ? live : order.parcels ?? [];
}
export function orderStage(order: WarehouseOrder, twin: TwinState) {
    if (order.status === 'packing') return order.packing_until_tick == null ? 'Paketleme sırası' : 'Paketleniyor';
    if (order.status !== 'picking') return STATUS[order.status] ?? order.status;
    const parcels = orderParcels(order, twin);
    if (parcels.length && parcels.every(p => p.status === 'DELIVERED')) return 'Paketleme kabulü bekleniyor';
    if (parcels.some(p => p.status === 'DELIVERED')) return 'Bileşenler bekleniyor';
    if (parcels.some(p => p.status === 'ON_CONVEYOR')) return 'Konveyörde';
    if (parcels.length && parcels.every(p => ['WAITING_INDUCTION', 'LOADING'].includes(p.status))) return 'Konveyör bekliyor';
    return 'Hazırlanıyor';
}
export function selectedOrderId(selection: SceneSelection | null, twin: TwinState, orders: WarehouseOrder[]) {
    if (selection?.kind === 'order') return selection.id;
    if (selection?.kind === 'package') return twin.packages?.[selection.id]?.order_id ?? null;
    if (selection?.kind === 'robot') {
        const task = twin.robots[selection.id]?.current_task_id;
        return orders.find(o => task && o.task_ids.includes(task))?.id ?? null;
    }
    return null;
}
export function focusSelection(selection: SceneSelection, orders: WarehouseOrder[] = []) {
    const s = useStore.getState(); let point: [number, number, number] | undefined, size: [number, number, number] = [14, 8, 14], floor = 1;
    const object = OBJECTS.find(o => o.kind === selection.kind && o.id === selection.id);
    if (object) { point = object.center; size = object.size; floor = object.floor; }
    if (selection.kind === 'robot') { const r = s.twin.robots[selection.id]; if (r) { floor = r.floor; point = [r.position[0], (layout.floors.find(f => f.id === r.floor)?.elevation ?? 0) + 1, r.position[2]]; size = [10, 6, 10]; } }
    if (selection.kind === 'package') { const p = s.twin.packages?.[selection.id]; if (p) { if (p.status === 'ON_CONVEYOR' || p.status === 'LOADING') point = parcelPosition(p); else if (p.robot_id && ['ON_ROBOT', 'WAITING_INDUCTION'].includes(p.status)) point = s.twin.robots[p.robot_id]?.position; else point = OBJECTS.find(o => o.id === (p.status === 'AWAITING_PICKUP' ? p.current_location : p.destination_station) || o.aliases.includes(p.current_location))?.center; } }
    if (selection.kind === 'order') {
        const order = orders.find(o => o.id === selection.id);
        if (order) { const parcels = orderParcels(order, s.twin); const points = parcels.flatMap(p => p.status === 'ON_CONVEYOR' ? [parcelPosition(p)] : p.robot_id && ['ON_ROBOT', 'WAITING_INDUCTION'].includes(p.status) && s.twin.robots[p.robot_id] ? [s.twin.robots[p.robot_id].position] : []); if (!points.length) points.push(...OBJECTS.filter(o => o.id === order.packing_station || order.items.some(i => o.id === i.rack_id || o.aliases.includes(i.rack_id))).map(o => o.center)); if (points.length) { const xs = points.map(p => p[0]), zs = points.map(p => p[2]); point = [(Math.min(...xs) + Math.max(...xs)) / 2, 1, (Math.min(...zs) + Math.max(...zs)) / 2]; size = [Math.max(15, Math.max(...xs) - Math.min(...xs) + 10), 8, Math.max(15, Math.max(...zs) - Math.min(...zs) + 10)]; } }
    }
    if (point) { s.setViewTab('3D'); s.setActiveFloor(floor); s.setCameraMode('orbit'); s.frame(point, size); }
}
export function parcelWait(parcel: Parcel, twin: TwinState) {
    if (parcel.status === 'DELIVERED') return null;
    const robot = parcel.robot_id && ['ON_ROBOT', 'WAITING_INDUCTION', 'LOADING'].includes(parcel.status) ? twin.robots[parcel.robot_id] : null;
    if (robot?.perception.state === 'STOPPED') return `Robot engel algıladı · ${fmt(robot.perception.ahead_m)} m açıklık`;
    if (robot && ['ERROR', 'OFFLINE'].includes(robot.status)) return `Robot ${ROBOT_STATUS[robot.status].toLocaleLowerCase('tr')}`;
    const segment = twin.conveyors[parcel.current_conveyor_segment ?? parcel.route[0]];
    if (segment && segment.status !== 'RUNNING') return `${segment.id} · ${segment.status}`;
    if (parcel.status === 'WAITING_INDUCTION') return 'Aktarım kuyruğunda. Ayrıntılı geçiş engeli snapshot içinde sağlanmıyor.';
    return null;
}
