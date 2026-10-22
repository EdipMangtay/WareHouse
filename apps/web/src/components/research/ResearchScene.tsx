import { Component, useEffect, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ResearchSnapshot } from '../../../../../packages/contracts/research';
import { useResearch } from '../../state/research';
import { relatedOrder, type SceneLayers } from './presentation';
import { Icon } from './Icon';
import { Actors } from './scene/Actors';
import { WarehouseEnvironment } from './scene/WarehouseEnvironment';
import { FlowResources } from './scene/FlowResources';
import { CameraRig } from './scene/CameraRig';
function useReducedMotion() {
    const [reduced, set] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => { const m = window.matchMedia('(prefers-reduced-motion: reduce)'), change = () => set(m.matches); m.addEventListener('change', change); return () => m.removeEventListener('change', change); }, []);
    return reduced;
}
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
    state = { error: false };
    static getDerivedStateFromError() { return { error: true }; }
    render() { return this.state.error ? <div className="wt-scene-fallback"><h2>3D görünüm açılamadı</h2><p>WebGL desteğini kontrol edin. Operasyon listeleri ve kontroller kullanılabilir.</p><button onClick={() => this.setState({ error: false })}>3D görünümü yeniden dene</button></div> : this.props.children; }
}
export function ResearchScene({ state, paused, generation }: { state: ResearchSnapshot; paused: boolean; generation: number }) {
    const selection = useResearch(s => s.selection), layers = useResearch(s => s.layers), camera = useResearch(s => s.camera);
    const [showLayers, setShowLayers] = useState(false), reduced = useReducedMotion(), orderId = relatedOrder(selection, state);
    const focus = useResearch.getState().focus;
    return <section className="wt-scene" aria-label="3D depo ve kamera kontrolleri">
        <div className="wt-scene-tools"><div className="wt-view-title"><Icon name="cube"/><span>DEPO GÖRÜNÜMÜ<small>{state.config.zones.length} bölge · ortak operasyon akışı</small></span></div><div className="wt-camera-buttons" aria-label="Kamera seçenekleri">
            <button aria-label="Genel görünüm" title="Genel görünüm" aria-pressed={camera.mode === 'overview'} onClick={() => focus(null, 'overview')}><Icon name="home"/><span>Genel</span></button>
            <button aria-label="Üstten görünüm" title="Üstten görünüm" aria-pressed={camera.mode === 'top'} onClick={() => focus(null, 'top')}><Icon name="top"/><span>Üstten</span></button>
            <select aria-label="Kamera odağı" value="" onChange={e => { const v = e.target.value; if (v.startsWith('zone:')) focus({ kind: 'zone', id: v.slice(5) }); else if (v === 'belt') focus({ kind: 'belt', id: 'BELT' }); else if (v === 'packing') focus({ kind: 'packing', id: state.packing[0]?.id ?? 'P1' }); else if (v === 'selection') focus(selection); }}><option value="">Odaklan…</option>{state.config.zones.map(z => <option key={z.id} value={`zone:${z.id}`}>{z.id} bölgesi</option>)}<option value="belt">Ortak konveyör</option><option value="packing">Paketleme alanı</option>{selection && <option value="selection">Seçilen nesne</option>}</select>
            <button aria-expanded={showLayers} aria-label="Görünüm katmanları" onClick={() => setShowLayers(v => !v)}><Icon name="layers"/><span>Katmanlar</span></button>
        </div></div>
        {showLayers && <div className="wt-layer-menu wt-surface"><div className="wt-panel-heading"><b>Görünüm katmanları</b><button className="wt-icon-button" aria-label="Katmanları kapat" onClick={() => setShowLayers(false)}><Icon name="close" size={14}/></button></div>{([['labels', 'Operasyon etiketleri'], ['racks', 'Raflar ve stok görselleri'], ['gaps', 'Güvenli takip aralığı'], ['reservations', 'Gelecek geçiş rezervasyonları']] as [keyof SceneLayers, string][]).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={e => useResearch.getState().setLayer(key, e.target.checked)}/>{label}</label>)}<p>Kesikli mor işaretler planlanan girişlerdir. Fiziksel taşıyıcılar dolu renkle gösterilir.</p></div>}
        <div className="wt-canvas"><SceneBoundary><Canvas shadows dpr={[1, 1.5]} camera={{ position: [(state.config.belt_length_m + 16) / 2 + 6, 50, 49], fov: 42, near: .1, far: 1500 }} onPointerMissed={() => useResearch.getState().select(null)} fallback={<div className="wt-scene-fallback">WebGL kullanılamıyor. Operasyon paneli kullanılabilir.</div>}>
            <group key={`${generation}-${state.scenario_seed}`}><WarehouseEnvironment state={state} layers={layers} selection={selection} orderId={orderId}/><FlowResources state={state} layers={layers} selection={selection} orderId={orderId}/><Actors state={state} selection={selection} orderId={orderId} paused={paused} labels={layers.labels} gaps={layers.gaps} reduced={reduced}/></group><CameraRig state={state} reduced={reduced}/>
        </Canvas></SceneBoundary></div>
        {state.belt.stopped && <div className="wt-belt-alert" role="status"><Icon name="alert"/><b>Konveyör durdu</b><span>Mevcut taşıyıcılar bekliyor · girişler kapalı</span></div>}
        <div className="wt-scene-legend"><span><i className="carrier"/>Ürün taşıyıcısı</span><span><i className="package"/>Müşteri paketi</span>{layers.reservations && <span><i className="reservation"/>Gelecek rezervasyon</span>}{orderId && <strong>{orderId} bileşenleri vurgulanıyor</strong>}</div>
        <div className="wt-scene-help">Sürükle: döndür · Sağ tuş: kaydır · Tekerlek: yaklaş · Nesne: incele</div>
    </section>;
}
