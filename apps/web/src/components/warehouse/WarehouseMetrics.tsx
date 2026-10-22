import { useStore } from '../../state/store';
import { useWarehouseOperations } from '../../state/warehouseOperations';
import { fmt } from './operations';
export function WarehouseMetrics() {
    const source = useStore(s => s.source);
    const twin = useStore(s => s.twin), data = useWarehouseOperations(s => s.data), error = useWarehouseOperations(s => s.error);
    const m = data?.metrics, fleet = twin.kpi.fleet;
    return <section className={`ww-metrics ${error || source !== 'online' ? 'stale' : ''}`} aria-label="Depo ölçümleri"><div className="ww-metric-title"><span className="ww-eyebrow">CANLI OPERASYON</span><h1>Siparişten sevkiyata.</h1></div><div><span>Aktif sipariş</span><b>{m?.active_orders ?? '—'}<small>sipariş</small></b></div><div><span>Sevkiyata hazır</span><b>{m?.ready_orders ?? '—'}<small>sipariş</small></b></div><div title="Commerce kayıtlarında sevkiyata hazır siparişlerin gelişten çıkışa gerçek simülasyon süresi"><span>Ort. tamamlanma</span><b>{m?.ready_orders ? fmt(m.avg_preparation_seconds) : '—'}<small>s / hazır sipariş</small></b></div><div><span>Konveyör girişi</span><b>{twin.conveyor_system?.metrics.waiting ?? '—'}<small>bekleyen taşıyıcı</small></b></div><div><span>Paketleme sırası</span><b>{m?.packing_queue ?? '—'}<small>sipariş</small></b></div><div className="ww-fleet-metric"><span>Robot durumları</span><b>{fleet.active}<small>görevde / {fleet.total}</small></b><small>{fleet.idle} hazır · {fleet.charging} şarj · {fleet.error} arızalı · {fleet.warning} uyarı · {fleet.offline} çevrimdışı</small></div></section>;
}
