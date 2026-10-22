import type { Carrier, Order, ResearchSnapshot, Robot, Policy } from '../../../../../packages/contracts/research';
export type Selection = { kind: 'zone' | 'robot' | 'carrier' | 'order' | 'packing' | 'belt' | 'consolidation' | 'dispatch'; id: string };
export type SceneLayers = { labels: boolean; racks: boolean; gaps: boolean; reservations: boolean };
export const POLICY_NAMES: Record<Policy, string> = { fifo: 'FIFO', order_aware: 'Sipariş odaklı', gwo_conveyor: 'GWO · konveyör', local_search: 'Yerel arama', gwo_integrated: 'GWO · bütünleşik' };
export const SCENARIO_NAMES: Record<string, string> = { balanced: 'Dengeli talep', hot_zone: 'Bölgesel yoğunluk', multi_zone: 'Çok bölgeli siparişler', limited_buffer: 'Sınırlı tampon', preparation_uncertainty: 'Hazırlama belirsizliği', robot_failure: 'Robot arızası', belt_stop: 'Konveyör duruşu', packing_outage: 'Paketleme kesintisi' };
export const ROBOT_NAMES: Record<string, string> = { IDLE: 'Hazır', ASSIGNED: 'Görev atandı', MOVING_TO_PICK: 'Rafa gidiyor', PICKING: 'Ürünü alıyor', CARRYING: 'Tampona taşıyor', DROPPING: 'Bırakıyor', WAITING: 'Bekliyor', CHARGING: 'Şarj oluyor', FAILED: 'Arızalı' };
export const ORDER_NAMES: Record<string, string> = { WAITING_ADMISSION: 'Alan bekliyor', PREPARING: 'Hazırlanıyor', WAITING_PACKING: 'Paketleme sırası', PACKING: 'Paketleniyor', COMPLETED: 'Sevkiyata hazır' };
export const WAIT_NAMES: Record<string, string> = { consolidation_capacity: 'Tüm bileşenler için birleştirme alanı bekleniyor.', packing_capacity_or_outage: 'Paketleme istasyonunun uygun olması bekleniyor.', packing_in_progress: 'Paketleme işlemi devam ediyor.', awaiting_components: 'Siparişin eksik bileşenlerinin ulaşması bekleniyor.' };
export const EVENT_NAMES: Record<string, string> = { ORDER_ARRIVED: 'Sipariş geldi', ORDER_ADMITTED: 'Birleştirme alanı ayrıldı', TASK_ASSIGNED: 'Görev atandı', ROBOT_PHASE: 'Robot durumu değişti', ITEM_PICKED: 'Ürün alındı', ITEM_READY: 'Ürün tamponda hazır', BELT_ENTERED: 'Konveyöre giriş', COMPONENT_ARRIVED: 'Bileşen birleştirmeye ulaştı', PACKING_STARTED: 'Paketleme başladı', PACKING_COMPLETED: 'Paketleme tamamlandı', TRANSFER_RESERVED: 'Geçiş rezerve edildi', RESERVATION_REVISED: 'Rezervasyon güncellendi', RESERVATION_CANCELLED: 'Rezervasyon iptal edildi', RESERVATION_INVALID: 'Geçiş engellendi', RESOURCE_INTERRUPTED: 'Kaynak kesintisi', RESOURCE_RESTORED: 'Kaynak yeniden kullanılabilir' };
export const fmt = (n: number | null | undefined, digits = 1) => n == null ? '—' : n.toLocaleString('tr-TR', { maximumFractionDigits: digits });
export const seconds = (n: number | null | undefined) => n == null ? 'Henüz gerçekleşmedi' : `${fmt(n)} s`;

/** Read-only presentation mappings; these never decide or mutate operations. */
export function orderStage(order: Order, state: ResearchSnapshot) {
    if (order.status !== 'PREPARING') return ORDER_NAMES[order.status] ?? order.status;
    const items = state.items.filter(i => i.order_id === order.id);
    if (items.some(i => i.location === 'CONSOLIDATION')) return 'Birleştirme bekliyor';
    if (state.carriers.some(c => c.order_id === order.id && c.state === 'ON_BELT')) return 'Taşınıyor';
    if (items.length && items.every(i => i.location.startsWith('BUFFER:'))) return 'Konveyör bekliyor';
    return 'Hazırlanıyor';
}
export function relatedOrder(selection: Selection | null, state: ResearchSnapshot): string | null {
    if (!selection) return null;
    if (selection.kind === 'order') return selection.id;
    if (selection.kind === 'carrier') return state.carriers.find(c => c.id === selection.id)?.order_id ?? null;
    if (selection.kind === 'packing') return state.packing.find(p => p.id === selection.id)?.order_id ?? null;
    if (selection.kind === 'robot') {
        const r = state.robots.find(r => r.id === selection.id);
        return state.tasks.find(t => t.id === r?.task_id)?.order_id ?? null;
    }
    return null;
}
export function itemLocation(location: string, state: ResearchSnapshot) {
    if (location === 'SHELF') return 'Rafta · hazırlama bekliyor';
    if (location === 'CONSOLIDATION') return 'Birleştirme alanında';
    if (location === 'PACKAGE') return 'Tamamlanmış pakette';
    if (location.startsWith('BUFFER:')) return `${location.slice(7)} · yerel tampon`;
    const c = state.carriers.find(c => c.id === location);
    if (c) return `Konveyör · ${fmt(c.position_m)} m`;
    const r = state.robots.find(r => r.id === location);
    return r ? `${r.id} üzerinde` : location;
}
export function carrierWait(carrier: Carrier, state: ResearchSnapshot) {
    if (carrier.state !== 'LOCAL_BUFFER') return null;
    if (state.belt.stopped) return 'Bant duruşu';
    const reservation = state.reservations.find(r => r.task_id === carrier.task_id);
    if (reservation && reservation.entry_s > state.time_s) return `Rezerve giriş zamanı: ${fmt(reservation.entry_s)} s`;
    const event = [...state.events].reverse().find(e => e.task_id === carrier.task_id && ['RESERVATION_INVALID', 'RESERVATION_CANCELLED', 'RESERVATION_REVISED'].includes(e.kind));
    if (event) return `${EVENT_NAMES[event.kind]}${event.reason ? ` · ${String(event.reason)}` : ''}`;
    return 'Ayrıntılı bekleme nedeni çekirdek tarafından sağlanmadı.';
}
export function robotTarget(robot: Robot) {
    if (['MOVING_TO_PICK', 'PICKING'].includes(robot.state)) return `${robot.zone_id} · toplama rafı`;
    if (['CARRYING', 'DROPPING'].includes(robot.state)) return `${robot.zone_id} · yerel tampon`;
    return robot.state === 'ASSIGNED' ? `${robot.zone_id} · toplama rafı` : 'Aktif hareket hedefi yok';
}
export type SimEvent = ResearchSnapshot['events'][number];
export function eventLinks(event: SimEvent, state: ResearchSnapshot) {
    const task = state.tasks.find(t => t.id === event.task_id);
    const item = state.items.find(i => i.id === event.item_id);
    const carrier = state.carriers.find(c => c.id === event.carrier_id);
    return { order: String(event.order_id ?? task?.order_id ?? item?.order_id ?? carrier?.order_id ?? ''), robot: String(event.robot_id ?? task?.robot_id ?? (state.robots.some(r => r.id === event.resource) ? event.resource : '') ?? '') };
}
export function eventSelection(event: SimEvent, state: ResearchSnapshot): Selection | null {
    const links = eventLinks(event, state);
    if (event.carrier_id) return { kind: 'carrier', id: String(event.carrier_id) };
    if (event.station_id || state.packing.some(p => p.id === event.resource)) return { kind: 'packing', id: String(event.station_id ?? event.resource) };
    if (links.robot) return { kind: 'robot', id: links.robot };
    if (links.order) return { kind: 'order', id: links.order };
    if (event.resource === 'BELT') return { kind: 'belt', id: 'BELT' };
    return null;
}
export function filterEvents(events: SimEvent[], state: ResearchSnapshot, filters: { order: string; robot: string; kind: string }) {
    return events.filter(e => { const links = eventLinks(e, state); return (!filters.order || links.order === filters.order) && (!filters.robot || links.robot === filters.robot) && (!filters.kind || e.kind === filters.kind); }).reverse();
}
