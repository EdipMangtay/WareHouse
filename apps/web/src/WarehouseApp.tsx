import { useEffect, useState } from 'react';
import { layout, useStore } from './state/store';
import { useWarehouseOperations } from './state/warehouseOperations';
import { useSimulationRunner } from './simulation/runner';
import { useWarehouseOperationsFeed } from './services/warehouseOperations';
import { Viewport } from './components/views/Viewport';
import { ScenariosDrawer } from './components/ops/ScenariosDrawer';
import { OpsDrawer } from './components/ops/OpsDrawer';
import { WhatIfDrawer } from './components/ops/WhatIfDrawer';
import { Modals } from './components/ops/Modals';
import { WarehouseToolbar } from './components/warehouse/WarehouseToolbar';
import { WarehouseMetrics } from './components/warehouse/WarehouseMetrics';
import { WarehouseSidebar } from './components/warehouse/WarehouseSidebar';
import { WarehouseInspector } from './components/warehouse/WarehouseInspector';
import { WarehouseEvents } from './components/warehouse/WarehouseEvents';
import { Icon } from './components/ui/WarehouseIcon';
import './warehouse-console.css';
import './performance.css';
import './warehouse-workbench.css';
function Notice() {
    const notice = useStore(s => s.notice);
    useEffect(() => { if (!notice) return; const timer = setTimeout(() => useStore.getState().setNotice(null), Math.max(0, notice.until - Date.now())); return () => clearTimeout(timer); }, [notice]);
    return notice ? <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span><button aria-label="Bildirimi kapat" onClick={() => useStore.getState().setNotice(null)}>×</button></div> : null;
}
export default function WarehouseApp() {
    useSimulationRunner(); useWarehouseOperationsFeed();
    const source = useStore(s => s.source), selection = useStore(s => s.selection), lift = useStore(s => s.selectedLift), dataError = useWarehouseOperations(s => s.error);
    const [expanded, setExpanded] = useState(false), [sidebar, setSidebar] = useState(() => window.innerWidth > 760);
    return <div className={`warehouse-console warehouse-workbench ${expanded ? 'ww-immersive' : ''}`}><WarehouseToolbar/>
        {source !== 'online' && <div className="ww-banner" role="status"><Icon name="alert"/>{source === 'connecting' ? 'Çekirdek bağlantısı kuruluyor…' : 'Bağlantı kesildi. Son doğrulanmış durum gösteriliyor; veriler güncel değil ve komutlar kapalı.'}</div>}
        {dataError && <div className="ww-banner" role="alert"><Icon name="alert"/>Sipariş verisi güncellenemedi. Son alınan kayıtlar gösteriliyor. {dataError}</div>}
        <WarehouseMetrics/>
        <main className={`ww-workspace ${selection || lift ? 'has-inspector' : ''}`}>
            {!expanded && sidebar && <WarehouseSidebar close={() => setSidebar(false)}/>}
            {!expanded && !sidebar && <button className="ww-open-sidebar" aria-label="Operasyonları aç" onClick={() => setSidebar(true)}><Icon name="list"/><span>Operasyonlar</span></button>}
            <section className="ww-stage" aria-label="Mevcut deponun canlı 3D görünümü"><Viewport workbench expanded={expanded} onExpandedChange={setExpanded}/></section>
            {!expanded && <WarehouseInspector/>}
        </main>
        {!expanded && <><div className="ww-flow-strip" aria-label="Operasyon akışı"><span className="ww-eyebrow">DEPO AKIŞI</span>{['Raflardan hazırlama', 'Bölgesel aktarım kuyruğu', 'Ortak konveyör', 'İstasyonda birleştirme', 'Paketleme', 'Sevkiyata hazır'].map((s, i) => <span key={s}><i>{String(i + 1).padStart(2, '0')}</i>{s}{i !== 5 && <Icon name="chevron" size={12}/>}</span>)}</div><WarehouseEvents/><footer className="ww-footer"><span>Mevcut {layout.metadata?.preset ?? layout.id} yerleşimi · {layout.racks.length} raf · {layout.size.width} × {layout.size.depth} m</span><span>Hız çarpanı yalnızca oynatmayı değiştirir.</span><a href="#admin">Operasyon merkezi ↗</a></footer></>}
        <ScenariosDrawer/><OpsDrawer/><WhatIfDrawer/><Modals/><Notice/>
    </div>;
}
