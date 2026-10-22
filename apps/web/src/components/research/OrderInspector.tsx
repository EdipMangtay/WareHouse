import type { Order, ResearchSnapshot } from '../../../../../packages/contracts/research';
import { useResearch } from '../../state/research';
import { fmt, itemLocation, orderStage, seconds, WAIT_NAMES } from './presentation';
import { Icon } from './Icon';
export function ReservationList({ state, taskIds }: { state: ResearchSnapshot; taskIds: string[] }) {
    const reservations = state.reservations.filter(r => taskIds.includes(r.task_id));
    return <div className="wt-reservations"><h3>Gerçek geçiş rezervasyonları</h3>{reservations.length ? reservations.map(r => <details key={r.task_id}><summary><span>{r.zone_id} → ortak bant</span><b>{fmt(r.entry_s)} s</b></summary><p>{r.task_id}<br/>{r.committed ? 'Bağlı plan' : 'Esnek plan'} · çıkış {fmt(r.exit_s)} s</p><dl className="wt-data">{Object.entries(r.crossings).map(([id, time]) => <div key={id}><dt>Birleşme {id}</dt><dd>{fmt(time)} s</dd></div>)}</dl></details>) : <p className="wt-muted">Etkin rezervasyon yok.</p>}</div>;
}
export function OrderInspector({ state, order }: { state: ResearchSnapshot; order: Order }) {
    const tasks = state.tasks.filter(t => t.order_id === order.id), carriers = state.carriers.filter(c => c.order_id === order.id);
    const ready = order.item_ids.length - order.missing_item_ids.length;
    const first = (values: (number | null)[]) => { const actual = values.filter((v): v is number => v != null); return actual.length ? Math.min(...actual) : null; };
    const allArrived = carriers.length === order.item_ids.length && carriers.every(c => c.arrived_s != null) ? Math.max(...carriers.map(c => c.arrived_s!)) : null;
    const stages: [string, number | null][] = [['Sipariş geldi', order.arrival_s], ['Hazırlama başladı', first(tasks.map(t => t.started_s))], ['İlk konveyör girişi', first(carriers.map(c => c.entered_s))], ['Tüm bileşenler ulaştı', allArrived], ['Paketleme başladı', order.packing_started_s], ['Sevkiyata hazır', order.completed_s]];
    return <><span className={`wt-status-pill ${order.status === 'COMPLETED' ? 'done' : ''}`}>{orderStage(order, state)}</span><p className="wt-reason">{order.wait_reason ? WAIT_NAMES[order.wait_reason] ?? order.wait_reason : 'Müşteri paketi tamamlandı.'}</p>
        <div className="wt-detail-stats"><div><b>{ready}<small> / {order.item_ids.length}</small></b><span>Ulaşan bileşen</span></div><div><b>{order.missing_item_ids.length}</b><span>Eksik bileşen</span></div></div>
        <dl className="wt-data"><div><dt>Ayrılan birleştirme alanı</dt><dd>{state.consolidation.orders[order.id] ?? 0} taşıyıcı yuvası</dd></div><div><dt>Son hedef zamanı</dt><dd>{fmt(order.due_s)} s</dd></div>{order.completed_s != null && <div><dt>Geliş → tamamlanma</dt><dd>{fmt(order.completed_s - order.arrival_s)} s</dd></div>}</dl>
        <h3>Bileşenler ve gerçek konumları</h3><div className="wt-items">{state.items.filter(i => i.order_id === order.id).map(i => {
            const carrier = carriers.find(c => c.item_id === i.id), robot = state.robots.find(r => r.id === i.location);
            const target = robot ? { kind: 'robot' as const, id: robot.id } : carrier && carrier.state !== 'CONSUMED' ? { kind: 'carrier' as const, id: carrier.id } : { kind: 'zone' as const, id: i.zone_id };
            return <button key={i.id} className="wt-item" onClick={() => { useResearch.getState().select(target); useResearch.getState().focus(target); }}><span className={`wt-item-icon ${order.missing_item_ids.includes(i.id) ? '' : 'ready'}`}><Icon name={order.missing_item_ids.includes(i.id) ? 'cube' : 'check'} size={16}/></span><span><b>{i.id}</b><small>{i.zone_id} · {itemLocation(i.location, state)}</small></span><Icon name="focus" size={14}/></button>;
        })}</div>
        <h3>Gerçekleşen aşamalar <small>simülasyon zamanı</small></h3><ol className="wt-timeline">{stages.map(([label, time]) => <li key={label} className={time != null ? 'done' : ''}><i/><span>{label}</span><time>{time == null ? '—' : seconds(time)}</time></li>)}</ol>
        <ReservationList state={state} taskIds={tasks.map(t => t.id)}/>
        <p className="wt-muted">Sipariş tamamlanma tahmini bu snapshot'ta sağlanmıyor. Çizelge gerçekleşmiş zamanları gösterir.</p>
    </>;
}
