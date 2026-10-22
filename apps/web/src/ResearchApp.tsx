import { useState } from 'react';
import { useResearch } from './state/research';
import { ResearchScene } from './components/research/ResearchScene';
import { ResearchToolbar } from './components/research/ResearchToolbar';
import { OperationsPanel } from './components/research/OperationsPanel';
import { SelectionInspector } from './components/research/SelectionInspector';
import { EventDock } from './components/research/EventDock';
import { SessionSetup } from './components/research/SessionSetup';
import { useResearchSession } from './components/research/useResearchSession';
import { fmt } from './components/research/presentation';
import { Icon } from './components/research/Icon';
import './research-tokens.css';
import './research.css';
export default function ResearchApp() {
    const session = useResearchSession(), { frame, connected, loading, error } = session;
    const selection = useResearch(s => s.selection);
    const [setup, setSetup] = useState(false), [operations, setOperations] = useState(() => window.innerWidth > 760);
    const state = frame?.state, metrics = state?.metrics;
    const working = state?.robots.filter(r => !['IDLE', 'FAILED', 'CHARGING', 'WAITING'].includes(r.state)).length ?? 0;
    return <div className="research-app">
        <ResearchToolbar session={session} setup={() => setSetup(true)}/>
        {(error || frame?.error) && <div className="wt-error-banner" role="alert"><Icon name="alert"/><span>{error || frame?.error}</span><button className="wt-icon-button" aria-label="Hata mesajını kapat" onClick={() => session.setError('')}><Icon name="close" size={15}/></button></div>}
        {frame && !connected && <div className="wt-offline-banner" role="status"><Icon name="alert"/><span>Bağlantı kesildi veya yenileniyor. Son kayıt: {fmt(state!.time_s)} s. Görüntü güncel değil; komutlar kapalı.</span></div>}
        {frame && state && metrics ? <>
            <section className="wt-metrics" aria-label="Operasyonel ölçümler"><div className="wt-metric-title"><span className="wt-eyebrow">CANLI OPERASYON</span><h1>Siparişten sevkiyata.</h1></div><div><span>Aktif sipariş</span><strong>{metrics.open_orders}<small>sipariş</small></strong></div><div><span>Sevkiyata hazır</span><strong>{metrics.completed_orders}<small>sipariş</small></strong></div><div title="Tamamlanan siparişler için gelişten paketleme bitişine"><span>Ort. tamamlanma</span><strong>{fmt(metrics.mean_completion_s)}<small>s / tamamlanan</small></strong></div><div><span>Yerel tamponlar</span><strong>{state.zones.reduce((n, z) => n + z.buffer_occupancy, 0)}<small>hazır taşıyıcı</small></strong></div><div><span>Paketleme kuyruğu</span><strong>{state.orders.filter(o => o.status === 'WAITING_PACKING').length}<small>sipariş</small></strong></div><div className="wt-robot-summary"><span>Robotlar</span><strong>{working}<small>çalışıyor / {state.robots.length}</small></strong><small>{state.robots.filter(r => r.state === 'IDLE').length} hazır · {state.robots.filter(r => r.state === 'FAILED').length} arızalı · {state.robots.filter(r => r.state === 'CHARGING').length} şarj · {state.robots.filter(r => r.state === 'WAITING').length} bekliyor</small></div></section>
            <main className={`wt-workspace ${operations ? 'has-operations' : ''} ${selection ? 'has-inspector' : ''}`}>
                {operations ? <OperationsPanel state={state} close={() => setOperations(false)}/> : <button className="wt-open-operations" aria-label="Operasyon panelini aç" onClick={() => setOperations(true)}><Icon name="list"/><span>Operasyonlar</span></button>}
                <ResearchScene key={frame.session_id} state={state} paused={frame.paused || !connected} generation={frame.generation}/>
                <SelectionInspector state={state}/>
            </main>
            <div className="wt-flow-strip" aria-label="Depo akışı"><span className="wt-eyebrow">SİPARİŞ AKIŞI</span>{['Hazırlama', 'Yerel tampon', 'Konveyöre giriş', 'Ortak konveyör', 'Birleştirme', 'Paketleme', 'Sevkiyata hazır'].map((name, i) => <span className="wt-flow-step" key={name}><i>{String(i + 1).padStart(2, '0')}</i>{name}{i < 6 && <Icon name="chevron" size={12}/>}</span>)}</div>
            <EventDock key={`${frame.session_id}-${frame.generation}`} state={state} session={session}/>
        </> : <main className="wt-welcome"><div className="wt-welcome-graphic" aria-hidden="true"><div>01<span>Z1</span></div><div>02<span>Z2</span></div><div>03<span>Z3</span></div><div>04<span>Z4</span></div><i/><b><Icon name="cube" size={32}/>TEK MÜŞTERİ PAKETİ</b></div><section><span className="wt-eyebrow">WARETWIN / OPERASYON STÜDYOSU</span><h1>Farklı bölgeler.<br/>Birlikte tamamlanan siparişler.</h1><p>Hazırlamadan sevkiyata, bütün akışı aynı depoda izleyin. Robotları, konveyör geçişlerini ve eksik sipariş bileşenlerini gerçek simülasyon verileriyle inceleyin.</p><button className="wt-primary" disabled={loading} onClick={() => setSetup(true)}>{loading ? 'Oturum yükleniyor…' : 'Depo oturumunu hazırla'}<Icon name="arrow"/></button><a href="#warehouse">Mevcut büyük depo görünümü ↗</a></section></main>}
        <footer className="wt-app-footer"><span>WareTwin <b> / </b> Çok bölgeli koordinasyon</span><span>Tüm operasyon süreleri simülasyon saniyesidir.</span><nav><a href="#warehouse">Büyük depo ↗</a><a href="#shop">Mağaza</a></nav></footer>
        {setup && <SessionSetup session={session} close={() => setSetup(false)}/>}
    </div>;
}
