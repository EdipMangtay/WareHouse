import { memo, useEffect, useRef, useState } from "react";
import { simControl } from "../../simulation/runner";
import { layout, useStore, type ViewTab, type SceneTool } from '../../state/store';
import { sceneBounds } from "../../layout/sceneBounds";
import { Icon } from '../ui/primitives';
import { Scene3D } from '../scene/Scene3D';
import { MapView2D } from './MapView2D';

import { NavigationTools } from "./NavigationTools";
import { ExperienceSearch, ExperienceLayers, ObjectInspector } from "./ExperienceControls";
import { CAMERA_NAMES, type CameraMode } from "../scene/experience";
import { PARCEL_COLORS } from '../scene/parcelPresentation';
import { CameraConsole, WalkHUD } from './CameraConsole';

const TABS: Array<[ViewTab, string]> = [['3D', '3D depo'], ['MAP', 'Yerleşim'], ['TRAFFIC', 'Trafik'], ['HEATMAP', 'Yoğunluk']];

export const Viewport = memo(function Viewport({ expanded, onExpandedChange, workbench = false }: { expanded: boolean; onExpandedChange: (value: boolean) => void; workbench?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenMessage, setScreenMessage] = useState('');
  const paused = useStore(s => s.paused);
  const robotIds = useStore(s => Object.keys(s.twin.robots).join('|')).split('|').filter(Boolean);
  const select = useStore(s => s.select);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement && useStore.getState().cameraMode !== 'walk') onExpandedChange(false);
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', key); };
  }, [onExpandedChange]);
  async function toggleFullscreen() {
    setScreenMessage('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        onExpandedChange(true);
        if (!container.current?.requestFullscreen || !document.fullscreenEnabled) {
          setScreenMessage('Sahne pencereyi kaplıyor. Tarayıcınız cihaz tam ekranını desteklemiyor.'); return;
        }
        await container.current.requestFullscreen();
      }
    } catch { setScreenMessage('Sahne pencereyi kaplıyor. Cihaz tam ekranı tarayıcı tarafından açılamadı.'); }
  }
  async function toggleExpanded() {
    if (document.fullscreenElement === container.current) await document.exitFullscreen().catch(() => {});
    onExpandedChange(!expanded); setScreenMessage('');
  }
  const tab = useStore(s => s.viewTab), setTab = useStore(s => s.setViewTab);
  const tool = useStore(s => s.tool), setTool = useStore(s => s.setTool);
  const showPaths = useStore(s => s.showPaths), togglePaths = useStore(s => s.togglePaths);
  const showLabels = useStore(s => s.showLabels), toggleLabels = useStore(s => s.toggleLabels);
  const focus = useStore(s => s.focus);
  const activeFloor = useStore(s => s.activeFloor), setActiveFloor = useStore(s => s.setActiveFloor);
  const cameraMode = useStore(s => s.cameraMode), setCameraMode = useStore(s => s.setCameraMode);
  const selectedRobot = useStore(s => s.selectedRobot);
  const quality = useStore(s => s.quality), setQuality = useStore(s => s.setQuality);
  const toolBtn = (t: SceneTool, icon: JSX.Element, label: string, on = tool === t, onClick = () => setTool(t)) => (
    <button key={t} className={on ? 'on' : ''} title={label} aria-label={label} aria-pressed={on} onClick={onClick}>{icon}</button>
  );
  return <div className={`viewport${cameraMode==='walk' ? ' viewport-walking' : ''}`} ref={container}>
    {(!workbench || expanded) && <div className="vp-screenbar">
      <a href="#admin" className="vp-brand">Ware<span>Twin</span> <small>{layout.metadata?.preset.toUpperCase() ?? "CANLI DEPO"} · {layout.size.width} × {layout.size.depth} m</small></a>
      <div className="vp-screen-actions">
        <select aria-label="Sahnede takip edilecek robot" value={selectedRobot ?? ''} onChange={event => { select(event.target.value); setCameraMode('third'); setTab('3D'); setActiveFloor('all'); }}>
          <option value="" disabled>Robot seç</option>{robotIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        <button onClick={() => paused ? simControl.play() : simControl.pause()} aria-label={paused ? 'Sahneyi devam ettir' : 'Sahneyi duraklat'}>{paused ? '▶ Devam et' : 'Ⅱ Duraklat'}</button>
        <button onClick={toggleExpanded} aria-pressed={expanded}>{expanded ? 'Operasyon paneli' : 'Sahneyi büyüt'}</button>
        <button className="vp-fullscreen" onClick={toggleFullscreen} aria-pressed={fullscreen}>{Icon.expand}<span>{fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}</span></button>
      </div>
    </div>}
    {screenMessage && <div className="vp-screen-message" role="status">{screenMessage}</div>}
    {!workbench && layout.metadata && <div className="vp-layout-summary" aria-label="Depo kapasitesi"><span>{(layout.size.width * layout.size.depth).toLocaleString('tr-TR')} m² tesis</span><span>{layout.racks.length} raf</span><span>{layout.metadata.counts.storage_slots.toLocaleString('tr-TR')} depolama adresi</span><span>{layout.conveyor_network?'4 robot bölgesi · 5 destek alanı':`${layout.zones.length} operasyon bölgesi`}</span>{layout.conveyor_network?.placement==='exterior'&&<span className="vp-exterior-badge">Dış çevre bant hattı · 4 cephe</span>}<span>Koridor ≥ {layout.metadata.config.corridor} m</span></div>}
    <div className="exp-command-row"><ExperienceSearch/>{tab === '3D' && <><ExperienceLayers/><NavigationTools/>{workbench && <button className="ww-scene-expand" onClick={toggleExpanded}>{expanded ? 'Panellere dön' : 'Sahneyi büyüt'}</button>}</>}</div>
    <div className="viewport-controls">
      <div className="view-tabs" role="group" aria-label="Depo görünümü">{TABS.map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      <div className="vp-toolbar">
        <select className="sel" aria-label="Depo katı" value={String(activeFloor)} onChange={event => {
          const value = event.target.value;
          const floor = value === 'all' || value === 'exploded' ? value : Number(value);
          setActiveFloor(floor); setCameraMode('orbit');
          focus(floor === 2 ? [31, 8, 51] : [layout.size.width / 2, 0, layout.size.depth / 2]);
        }}>
          <option value="all">Tüm katlar</option><option value="1">Zemin kat</option>{layout.floors.length > 1 && <><option value="2">Asma kat</option><option value="exploded">Katları ayır</option></>}
        </select>
        {tab === '3D' && <>
          <select className="sel" aria-label="Kamera açısı" value={cameraMode} onChange={event => setCameraMode(event.target.value as CameraMode)}>
            {Object.entries(CAMERA_NAMES).map(([mode,label])=><option key={mode} value={mode} disabled={["first","third"].includes(mode)&&!selectedRobot}>{label}</option>)}
          </select>
          <select className="sel" aria-label="Görüntü kalitesi" value={quality} onChange={event => setQuality(event.target.value as 'low' | 'medium' | 'high')}>
            <option value="low">Ekonomik</option><option value="medium">Dengeli</option><option value="high">Yüksek kalite</option>
          </select>
          {layout.conveyor_network?.placement==='exterior'&&<button className="vp-belt-view" onClick={()=>{const site=sceneBounds(layout);setActiveFloor(1);setCameraMode('top');useStore.getState().frame(site.center,site.size);}}>Dış bant hattı ↗</button>}
          <button className="icon-btn" title="Depoya genel bakış" aria-label="Depoya genel bakış" onClick={() => { setCameraMode('orbit'); focus([layout.size.width / 2, 0, layout.size.depth / 2]); }}>{Icon.expand}</button>
        </>}
      </div>
    </div>
    <div className="viewport-scene">
      {tab === '3D' ? <Scene3D /> : <MapView2D mode={tab} />}
      {tab === '3D' && <CameraConsole/>}{workbench && tab === '3D' && !['walk','first','third'].includes(cameraMode) && <div className="ww-scene-legend" aria-label="Taşıyıcı renkleri"><span><i style={{background:PARCEL_COLORS.component}}/>Ürün taşıyıcısı</span><span><i style={{background:PARCEL_COLORS.packed}}/>Paketleme sonrası yük</span><span><i style={{background:PARCEL_COLORS.selected}}/>Seçili / ilişkili</span></div>}
      {tab === '3D' && cameraMode==='walk' && <WalkHUD/>}
      {!workbench && <ObjectInspector/>}
      {tab === '3D' && cameraMode!=='walk' && <div className="scene-toolbar" role="group" aria-label="Sahne araçları">
        {toolBtn('select', Icon.cursor, 'Robot seç')}
        {toolBtn('pan', Icon.hand, 'Sahneyi kaydır')}
        {toolBtn('paths', Icon.path, 'Rotaları göster', showPaths, togglePaths)}
        {toolBtn('labels', Icon.tag, 'Etiketleri göster', showLabels, toggleLabels)}
      </div>}
    </div>
  </div>;
});
