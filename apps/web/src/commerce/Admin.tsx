import { useEffect, useRef, useState } from 'react';
import type { TwinState } from '../schema/twin_state';
import './admin.css';

type Order = {
  id: string; tracking_code: string; customer_name: string; total_cents: number;
  delivery_method: string; status: string; created_at: string; robot_ids: string[];
  items: { quantity: number }[];
};
type AdminData = {
  orders: Order[];
  metrics: {
    active_orders: number; total_orders: number; ready_orders: number;
    avg_preparation_seconds: number | null; robot_utilization: number; queue_depth: number;
    packing_busy: number; packing_capacity: number;
  };
  stress: {
    running: boolean; rate_per_minute: number; created: number; failed: number;
    remaining_seconds: number; elapsed_seconds?: number; achieved_rate_per_minute?: number;
  };
  performance: { api_latency_ms: number | null; db_latency_ms: number | null; cpu_percent: number | null; memory_mb: number | null };
};
type Sample = { time: number; queue: number; active: number };
type RoutingComparison = {
  robot_id: string; target_id: string; tick: number; blocked_cells: number;
  results: { algorithm: string; status: string; cost: number | null; distance_m: number | null; duration_ms: number; expanded_nodes: number }[];
};
const statusNames: Record<string, string> = {
  CREATED: 'Alındı', RECEIVED: 'Alındı', QUEUED: 'Sırada', CONFIRMED: 'Onaylandı',
  PICKING: 'Toplanıyor', PACKING: 'Paketleniyor', LOADING: 'Yükleniyor',
  READY: 'Sevkiyata hazır', READY_FOR_DISPATCH: 'Sevkiyata hazır', READY_FOR_DELIVERY: 'Sevkiyata hazır',
  WAITING: 'Sırada', PROCESSING: 'Hazırlanıyor', FAILED: 'İşlem hatası', CANCELLED: 'İptal edildi',
};
const robotNames: Record<string, string> = { ACTIVE: 'Çalışıyor', IDLE: 'Hazır', CHARGING: 'Şarj oluyor', ERROR: 'Arızalı', OFFLINE: 'Çevrimdışı', WARNING: 'Uyarı' };
const money = (cents: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(cents / 100);
const number = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('tr-TR', { maximumFractionDigits: digits });
const percent = (value: number) => Math.max(0, Math.min(100, value * 100));
const isReady = (status: string) => status.startsWith('READY');
function statusName(status: string) { return statusNames[status] ?? status; }
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `İstek tamamlanamadı (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function ActivityChart({ samples }: { samples: Sample[] }) {
  const max = Math.max(5, ...samples.flatMap(s => [s.active, s.queue]));
  const points = (key: 'active' | 'queue') => samples.map((s, i) => `${30 + i / Math.max(1, samples.length - 1) * 610},${155 - s[key] / max * 130}`).join(' ');
  return <div className="adm-chart">
    {samples.length < 2 ? <div className="adm-chart-empty">Grafik için canlı ölçümler toplanıyor…</div> : <svg viewBox="0 0 660 190" role="img" aria-label={`Son ${samples.length} ölçüm: ${samples[samples.length - 1]?.active ?? 0} aktif sipariş, ${samples[samples.length - 1]?.queue ?? 0} kuyrukta sipariş`}>
      {[0, 0.5, 1].map(v => <g key={v}><line x1="30" x2="640" y1={155 - v * 130} y2={155 - v * 130} stroke="#edf0f2" /><text x="0" y={159 - v * 130}>{number(Math.round(max * v))}</text></g>)}
      <polyline points={points('active')} fill="none" stroke="#1a7964" strokeWidth="3" strokeLinejoin="round" />
      <polyline points={points('queue')} fill="none" stroke="#e69e4d" strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="5 4" />
      <text x="30" y="184">{new Date(samples[0].time).toLocaleTimeString('tr-TR')}</text>
      <text x="640" y="184" textAnchor="end">Şimdi</text>
    </svg>}
  </div>;
}

export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [twin, setTwin] = useState<TwinState | null>(null);
  const [error, setError] = useState('');
  const [fleetError, setFleetError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [rate, setRate] = useState(100);
  const [duration, setDuration] = useState(30);
  const [robotId, setRobotId] = useState('');
  const [page, setPage] = useState(0);
  const [routing, setRouting] = useState<RoutingComparison | null>(null);
  const [routingPending, setRoutingPending] = useState(false);
  const [routingError, setRoutingError] = useState('');
  const refresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true;
    let busy = false;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (busy) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8000);
      const results = await Promise.allSettled([
        request<AdminData>('/api/commerce/admin', { signal: controller.signal }),
        request<TwinState>('/api/state', { signal: controller.signal }),
      ]);
      clearTimeout(timeout);
      if (active) {
        const [commerce, fleet] = results;
        if (commerce.status === 'fulfilled') {
          setData({ ...commerce.value, orders: commerce.value.orders.map(order => ({ ...order, status: order.status.toUpperCase() })) }); setError(''); setUpdated(new Date());
          setSamples(previous => [...previous, { time: Date.now(), queue: commerce.value.metrics.queue_depth, active: commerce.value.metrics.active_orders }].slice(-60));
        } else setError('Sunucuyla bağlantı kurulamadı. Bağlantı otomatik olarak yeniden deneniyor.');
        if (fleet.status === 'fulfilled') { setTwin(fleet.value); setFleetError(''); }
        else setFleetError('Depo verisi yenilenemedi; gösterilen filo bilgisi güncel olmayabilir.');
      }
      busy = false;
    };
    refresh.current = poll;
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; clearInterval(timer); controller?.abort(); };
  }, []);

  async function act(path: string, body: object, success: string) {
    setPending(true); setNotice('');
    try { await request(path, { method: 'POST', body: JSON.stringify(body) }); setNotice(success); await refresh.current(); }
    catch (cause) { setNotice(`İşlem başarısız: ${cause instanceof Error ? cause.message : 'Beklenmeyen hata.'}`); }
    finally { setPending(false); }
  }

  async function compareRoutes() {
    setRoutingPending(true); setRoutingError('');
    try { setRouting(await request<RoutingComparison>('/api/routing/compare')); }
    catch (cause) { setRoutingError(cause instanceof Error ? cause.message : 'Rota karşılaştırması tamamlanamadı.'); }
    finally { setRoutingPending(false); }
  }

  const robots = Object.values(twin?.robots ?? {});
  const unavailable = robots.filter(r => r.status === 'ERROR' || r.status === 'OFFLINE');
  const working = robots.filter(r => r.current_task_id && !['ERROR', 'OFFLINE'].includes(r.status));
  const selectedRobot = robots.find(r => r.id === robotId);
  const filtered = (data?.orders ?? []).filter(order =>
    (filter === 'ALL' || (filter === 'READY' ? isReady(order.status) : filter === 'ACTIVE' ? !isReady(order.status) && !['CANCELLED', 'FAILED'].includes(order.status) : order.status === filter)) &&
    `${order.id} ${order.tracking_code} ${order.customer_name}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const visiblePage = Math.min(page, pages - 1);
  const metrics = data?.metrics;
  const disabled = pending || !data || !!error;
  const elapsed = data?.stress.elapsed_seconds;
  const achievedRate = data?.stress.achieved_rate_per_minute ?? (elapsed && elapsed > 0 ? data!.stress.created * 60 / elapsed : null);

  return <main className="commerce-admin">
    <div className="adm-heading">
      <div><span className="adm-eyebrow">OPERASYON MERKEZİ</span><h1>Depodaki her hareket,<br className="adm-mobile-break" /> tek bir yerde.</h1><p>Siparişten sevkiyata, dijital ikizinizin canlı operasyon görünümü.</p></div>
      <a className="adm-button adm-primary" href="#warehouse"><span aria-hidden="true">◈</span> 3D depoyu aç <span aria-hidden="true">↗</span></a>
    </div>

    <div className="adm-livebar"><span className={`adm-live ${error ? 'adm-offline' : ''}`}><i />{error ? 'Bağlantı kesildi' : data ? 'Canlı veriler' : 'Bağlanıyor'}</span><span>{updated ? `Son güncelleme ${updated.toLocaleTimeString('tr-TR')}` : 'İlk ölçüm bekleniyor'} · 2 sn aralıkla</span><span className="adm-environment">DEPO SİMÜLASYONU</span></div>
    {error && <div className="adm-alert" role="alert">{error} {data && 'Son alınan değerler gösteriliyor.'}<button onClick={() => void refresh.current()}>Yeniden dene</button></div>}
    {notice && <div className="adm-notice" role="status">{notice}<button aria-label="Bildirimi kapat" onClick={() => setNotice('')}>×</button></div>}

    <section className="adm-metrics" aria-label="Temel operasyon göstergeleri">
      <article className="adm-metric"><div><span>Aktif sipariş</span><span className="adm-metric-symbol" aria-hidden="true">▤</span></div><strong>{number(metrics?.active_orders)}</strong><p>Toplam {number(metrics?.total_orders)} sipariş içinde</p></article>
      <article className="adm-metric"><div><span>Sevkiyata hazır</span><span className="adm-metric-symbol" aria-hidden="true">✓</span></div><strong>{number(metrics?.ready_orders)}</strong><p>Depo hazırlığı tamamlandı</p></article>
      <article className="adm-metric"><div><span>Ort. hazırlama süresi</span><span className="adm-metric-symbol" aria-hidden="true">◷</span></div><strong>{number(metrics?.avg_preparation_seconds, 1)} <small>sn</small></strong><p>Tamamlanan depo işlemleri</p></article>
      <article className="adm-metric"><div><span>Robot kullanım oranı</span><span className="adm-metric-symbol" aria-hidden="true">⌘</span></div><strong>{metrics ? number(percent(metrics.robot_utilization), 1) : '—'}<small>%</small></strong><p>{twin ? `${working.length} robot görevde · ${robots.length} robot toplam` : 'Filo bilgisi bekleniyor'}</p></article>
    </section>

    <div className="adm-overview-grid">
      <section className="adm-card adm-flow"><div className="adm-section-head"><div><h2>Operasyon akışı</h2><p>Bu oturumda alınan son 60 canlı ölçüm</p></div><div className="adm-legend"><span><i />Aktif sipariş</span><span><i />Sipariş kuyruğu</span></div></div><ActivityChart samples={samples} /><div className="adm-flow-footer"><span>Sipariş kuyruğu <b>{number(metrics?.queue_depth)}</b></span><span>Paketleme istasyonları <b>{number(metrics?.packing_busy)} / {number(metrics?.packing_capacity)}</b></span></div></section>
      <section className="adm-card adm-capacity"><div className="adm-section-head"><div><h2>Depo kapasitesi</h2><p>Canlı kaynak dağılımı</p></div><span className="adm-subtle-icon" aria-hidden="true">◫</span></div>
        <div className="adm-capacity-row"><div><span>Robot filosu</span><strong>{metrics ? number(percent(metrics.robot_utilization), 1) : '—'}%</strong></div><meter min="0" max="100" value={metrics ? percent(metrics.robot_utilization) : 0} aria-label="Robot kullanım yüzdesi" /></div>
        <div className="adm-capacity-row"><div><span>Paketleme doluluğu</span><strong>{metrics?.packing_capacity ? number(metrics.packing_busy / metrics.packing_capacity * 100) : '—'}%</strong></div><meter min="0" max={metrics?.packing_capacity || 1} value={metrics?.packing_busy ?? 0} aria-label="Paketleme doluluğu" /></div>
        <div className={`adm-capacity-note ${unavailable.length ? 'adm-warning-note' : ''}`}><span aria-hidden="true">{unavailable.length ? '!' : '✓'}</span><p>{!twin ? 'Filo verileri bekleniyor.' : unavailable.length ? `${unavailable.length} robot kullanılamıyor. Görev atamalarını ve kuyruk yoğunluğunu takip edin.` : 'Tüm robotlar erişilebilir. Yeni siparişler depo görev kuyruğuna aktarılır.'}</p></div>
        <p className="adm-small">Şehir ve drone simülasyonu bu aşamanın kapsamı dışındadır.</p>
      </section>
    </div>

    <section className="adm-card adm-orders"><div className="adm-section-head"><div><h2>Siparişler <span className="adm-count">{number(data?.orders.length)}</span></h2><p>Depo hazırlığını ve atanan robotları izleyin.</p></div><div className="adm-filters"><input aria-label="Sipariş, takip kodu veya müşteri ara" placeholder="Sipariş veya müşteri ara…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /><select aria-label="Sipariş durumu" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="ALL">Tüm durumlar</option><option value="ACTIVE">Aktif</option><option value="RECEIVED">Sırada</option><option value="PICKING">Toplanıyor</option><option value="PACKING">Paketleniyor</option><option value="READY">Sevkiyata hazır</option><option value="FAILED">İşlem hatası</option></select></div></div>
      <div className="adm-table-wrap"><table><thead><tr><th>Sipariş / takip kodu</th><th>Müşteri</th><th>Durum</th><th>Robot</th><th>Tutar</th><th>Oluşturulma</th><th><span className="adm-sr-only">Takip bağlantısı</span></th></tr></thead><tbody>{filtered.slice(visiblePage * 8, visiblePage * 8 + 8).map(order => <tr key={order.id}><td><a href={`#track/${encodeURIComponent(order.tracking_code)}`} className="adm-order-id">{order.tracking_code}</a><small>{order.items.reduce((sum, item) => sum + item.quantity, 0)} ürün</small></td><td>{order.customer_name}</td><td><span className={`adm-status ${isReady(order.status) ? 'adm-status-ready' : ['FAILED', 'CANCELLED'].includes(order.status) ? 'adm-status-error' : ['PICKING', 'PACKING', 'LOADING'].includes(order.status) ? 'adm-status-progress' : ''}`}><i />{statusName(order.status)}</span></td><td className="adm-robot-ids">{order.robot_ids?.join(', ') || 'Atama bekliyor'}</td><td>{money(order.total_cents)}</td><td>{new Date(order.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</td><td><a className="adm-table-link" aria-label={`${order.tracking_code} siparişini takip et`} href={`#track/${encodeURIComponent(order.tracking_code)}`}>↗</a></td></tr>)}</tbody></table>
      {!filtered.length && <div className="adm-empty"><span aria-hidden="true">▤</span><h3>{!data ? error ? 'Sipariş verisine ulaşılamıyor' : 'Siparişler yükleniyor…' : query || filter !== 'ALL' ? 'Eşleşen sipariş bulunamadı' : 'İlk siparişinizi bekliyoruz'}</h3><p>{!data ? 'Backend bağlantısı sağlandığında veriler burada görünecek.' : query || filter !== 'ALL' ? 'Arama veya durum filtresini değiştirebilirsiniz.' : 'Mağazadan sipariş oluşturun ya da bir yük senaryosu başlatın.'}</p></div>}</div>
      <div className="adm-table-footer"><span>{filtered.length} eşleşen kayıt · Son siparişler</span><div><button aria-label="Önceki sipariş sayfası" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>←</button><span>{visiblePage + 1} / {pages}</span><button aria-label="Sonraki sipariş sayfası" disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>→</button></div></div>
    </section>

    <div className="adm-bottom-grid">
      <section className="adm-card adm-stress"><div className="adm-section-head"><div><span className="adm-eyebrow">SENARYO LABORATUVARI</span><h2>Yoğunluğu artırın. Etkisini görün.</h2><p>Sipariş hacminin depo kapasitesine etkisini ölçün.</p></div><span className="adm-subtle-icon" aria-hidden="true">↗</span></div>
        <label className="adm-label">Dakikadaki sipariş sayısı</label><div className="adm-rate-options" role="group" aria-label="Dakikadaki sipariş sayısı">{[5, 100, 500, 1000].map(value => <button key={value} aria-pressed={rate === value} className={rate === value ? 'adm-selected' : ''} disabled={data?.stress.running || pending} onClick={() => setRate(value)}><b>{value}</b><span>sipariş / dk</span></button>)}</div>
        <div className="adm-stress-actions"><label>Süre <select aria-label="Stres testi süresi" value={duration} disabled={data?.stress.running || pending} onChange={e => setDuration(Number(e.target.value))}><option value={10}>10 saniye</option><option value={30}>30 saniye</option><option value={60}>1 dakika</option><option value={120}>2 dakika</option><option value={300}>5 dakika</option></select></label>{data?.stress.running ? <button className="adm-button adm-danger" disabled={disabled} onClick={() => void act('/api/commerce/stress/stop', {}, 'Sipariş üretimi durduruldu. Oluşmuş siparişler işlenmeye devam eder.')}>Testi durdur</button> : <button className="adm-button adm-primary" disabled={disabled} onClick={() => void act('/api/commerce/stress', { rate_per_minute: rate, duration_seconds: duration }, 'Yük senaryosu başlatıldı. Sonuçlar canlı olarak güncelleniyor.')}>{pending ? 'İşleniyor…' : 'Senaryoyu başlat →'}</button>}</div>
        <div className="adm-test-results"><div><span>Üretilen</span><b>{number(data?.stress.created)}</b></div><div><span>Başarısız</span><b>{number(data?.stress.failed)}</b></div><div><span>{data?.stress.running ? 'Kalan süre' : 'Gerçekleşen hız'}</span><b>{data?.stress.running ? `${number(data.stress.remaining_seconds)} sn` : `${number(achievedRate, 1)} / dk`}</b></div></div>
        {data?.stress.running && <p className="adm-running" role="status"><i />Senaryo çalışıyor · Hedef {data.stress.rate_per_minute} sipariş / dk</p>}
        <p className="adm-small">Uygulama içi sentetik sipariş yüküdür. Harici HTTP trafik testi değildir. Oluşturulan test siparişleri gerçek depo görevleri üretir.</p>
      </section>
      <section className="adm-card adm-performance"><div className="adm-section-head"><div><h2>Sistem performansı</h2><p>Sunucudan gelen ölçümler</p></div><span className="adm-subtle-icon" aria-hidden="true">⌁</span></div>
        <dl><div><dt>API yanıt başlangıcı</dt><dd>{number(data?.performance.api_latency_ms, 1)} <small>ms</small></dd></div><div><dt>Veri tabanı sorgusu</dt><dd>{number(data?.performance.db_latency_ms, 2)} <small>ms</small></dd></div><div><dt>CPU kullanımı</dt><dd>{number(data?.performance.cpu_percent, 1)} <small>%</small></dd></div><div><dt>Bellek tepe kullanımı</dt><dd>{number(data?.performance.memory_mb, 1)} <small>MB</small></dd></div></dl><p className="adm-small">“—” ölçümün henüz mevcut olmadığını gösterir. CPU ve bellek bu backend sürecine aittir. API değeri sunucunun yanıtı başlatma ortalamasıdır; ağ gecikmesini içermez.</p>
      </section>
    </div>

    <section className="adm-card adm-routing"><div className="adm-section-head"><div><h2>Rota algoritmalarını karşılaştırın</h2><p>Aynı depo haritası, aynı engeller ve aynı başlangıç noktası.</p></div><button className="adm-button adm-secondary" disabled={routingPending || !twin || !!fleetError} onClick={() => void compareRoutes()}>{routingPending ? 'Hesaplanıyor…' : 'Karşılaştırmayı çalıştır →'}</button></div>
      {routingError && <p className="adm-alert" role="alert">{routingError}</p>}
      {routing ? <><div className="adm-table-wrap"><table><thead><tr><th>Algoritma</th><th>Sonuç</th><th>Ağırlıklı maliyet</th><th>Mesafe</th><th>Hesaplama</th><th>İncelenen düğüm</th></tr></thead><tbody>{routing.results.map(result => <tr key={result.algorithm}><td><strong>{{ astar: 'A*', dijkstra: 'Dijkstra', bellman_ford: 'Bellman–Ford' }[result.algorithm] ?? result.algorithm}</strong></td><td>{result.status === 'found' ? 'Rota bulundu' : result.status === 'unreachable' ? 'Ulaşılamıyor' : 'Hesaplama limiti'}</td><td>{number(result.cost, 2)}</td><td>{number(result.distance_m, 1)} m</td><td>{number(result.duration_ms, 2)} ms</td><td>{number(result.expanded_nodes)}</td></tr>)}</tbody></table></div><p className="adm-routing-context">{routing.robot_id} → {routing.target_id} · Simülasyon adımı {routing.tick} · {routing.blocked_cells} engelli hücre</p></> : <div className="adm-routing-empty">Bir karşılaştırma başlatarak canlı depo durumundaki üç algoritmanın sonuçlarını görüntüleyin.</div>}
      <p className="adm-small adm-routing-note">Sonuçlar düğmeye basıldığı andaki haritaya aittir. Bellman–Ford kuyruk tabanlı çalışır. Karşılaştırma robot görevlerini değiştirmez; canlı robotlar A* kullanmaya devam eder.</p>
    </section>

    <section className="adm-card adm-fleet"><div className="adm-section-head"><div><h2>Robot filosu <span className="adm-count">{robots.length}</span></h2><p>Gerçek depo simülatörünün görev, batarya ve sağlık verileri.</p></div><div className="adm-fleet-summary"><span><i className="adm-dot-green" />{working.length} görevde</span><span><i className="adm-dot-red" />{unavailable.length} kullanılamıyor</span></div></div>
      {fleetError && <p className="adm-alert" role="alert">{fleetError}</p>}
      <div className="adm-robot-grid">{robots.map(robot => <article className={`adm-robot ${['ERROR', 'OFFLINE'].includes(robot.status) ? 'adm-robot-fault' : ''}`} key={robot.id}><div className="adm-robot-top"><span className="adm-robot-icon" aria-hidden="true">▣</span><strong>{robot.id}</strong><span>{robotNames[robot.status] ?? robot.status}</span></div><div className="adm-robot-task">{robot.current_task_id ? `Görev ${robot.current_task_id}` : 'Atanmış görev yok'}</div><div className="adm-robot-battery"><span>Batarya</span><b>%{number(robot.battery)}</b></div><meter min="0" max="100" low={20} optimum={100} value={robot.battery} aria-label={`${robot.id} batarya yüzdesi`} /><div className="adm-robot-detail"><span>Sağlık %{number(robot.health)}</span><span>{robot.floor}. kat · {robot.zone ?? '—'}</span></div></article>)}</div>
      {!robots.length && <div className="adm-empty"><p>Filo verileri bekleniyor.</p></div>}
      <div className="adm-simulation-controls"><div><h3>Simülasyon kontrolü</h3><p>{twin?.sim.mode === 'PAUSED' ? 'Depo simülasyonu duraklatıldı.' : twin ? `Depo simülasyonu ${twin.sim.speed}× hızda çalışıyor.` : 'Depo bağlantısı bekleniyor.'}</p></div><div className="adm-control-group"><select aria-label="Simülasyon hızı" disabled={pending || !twin || !!fleetError} value={twin?.sim.speed || 1} onChange={e => void act('/api/sim', { action: twin?.sim.mode === 'PAUSED' ? 'PAUSE' : 'PLAY', speed: Number(e.target.value) }, 'Simülasyon hızı güncellendi.')}><option value={1}>1× hız</option><option value={2}>2× hız</option><option value={5}>5× hız</option><option value={10}>10× hız</option></select><button className="adm-button adm-secondary" disabled={pending || !twin || !!fleetError} onClick={() => void act('/api/sim', { action: twin?.sim.mode === 'PAUSED' ? 'PLAY' : 'PAUSE', speed: twin?.sim.speed || 1 }, twin?.sim.mode === 'PAUSED' ? 'Simülasyon devam ediyor.' : 'Simülasyon duraklatıldı.')}>{twin?.sim.mode === 'PAUSED' ? '▶ Devam et' : 'Ⅱ Duraklat'}</button></div></div>
      <div className="adm-fault-controls"><div><h3>Robot arıza senaryosu</h3><p>Seçilen robotu devre dışı bırakarak görev aktarımını gözlemleyin.</p></div><div className="adm-control-group"><select aria-label="Arıza senaryosu için robot" value={robotId} onChange={e => setRobotId(e.target.value)}><option value="">Robot seçin</option>{robots.map(robot => <option key={robot.id} value={robot.id}>{robot.id} · {robotNames[robot.status] ?? robot.status}</option>)}</select><button className="adm-button adm-secondary" disabled={pending || !selectedRobot || !!fleetError} onClick={() => {
        const recovering = selectedRobot?.status === 'ERROR' || selectedRobot?.status === 'OFFLINE';
        void act(recovering ? '/api/inject/clear' : '/api/inject', recovering ? { kind: 'ROBOT_FAILURE', target_id: robotId } : { kind: 'ROBOT_FAILURE', robot_id: robotId }, recovering ? `${robotId} için arıza senaryosu kaldırıldı.` : `${robotId} için arıza senaryosu uygulandı.`);
      }}>{selectedRobot && ['ERROR', 'OFFLINE'].includes(selectedRobot.status) ? 'Arızayı kaldır' : 'Arıza oluştur'}</button></div></div>
    </section>
    <footer className="adm-footer">WARETWIN <span>Depo operasyonları · Canlı dijital ikiz</span><a href="#shop">Mağazaya dön ↗</a></footer>
  </main>;
}
