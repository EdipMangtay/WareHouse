import { useEffect, useState } from 'react';
import { layout, tickToClock, useStore } from '../../state/store';
import { simControl } from '../../simulation/runner';
import { resetCamera } from '../views/CameraConsole';
import { Icon } from '../ui/WarehouseIcon';
export function WarehouseToolbar() {
    const twin = useStore(s => s.twin), source = useStore(s => s.source), paused = useStore(s => s.paused), actualSpeed = useStore(s => s.speed);
    const [speed, setSpeed] = useState<0.25 | 0.5 | 1 | 2 | 4 | 5 | 10>(actualSpeed || 1);
    useEffect(() => { if (actualSpeed) setSpeed(actualSpeed); }, [actualSpeed]);
    return <header className="ww-toolbar"><a className="ww-brand" href="#admin"><Icon name="cube" size={28}/><strong>ware<span>twin</span><small>DEPO OPERASYONLARI</small></strong></a><div className="ww-scenario"><b>{layout.metadata?.preset.toUpperCase() ?? layout.name} · Mevcut depo</b><span>{layout.size.width} × {layout.size.depth} m · tohum {twin.sim.seed}</span></div><div className="ww-playback"><div className="ww-clock"><b>{tickToClock(twin.sim.tick, twin.sim.tick_ms, true)}</b><span><i className={paused ? '' : 'running'}/>{source !== 'online' ? 'Son snapshot' : paused ? 'Duraklatıldı' : 'Çalışıyor'} · {(twin.sim.tick * twin.sim.tick_ms / 1000).toFixed(1)} s</span></div><button className="ww-primary" disabled={source !== 'online'} onClick={() => paused ? simControl.play(speed) : simControl.pause()}><Icon name={paused ? 'play' : 'pause'} size={14}/>{paused ? 'Devam et' : 'Duraklat'}</button><select aria-label="Simülasyon hızı" value={speed} disabled={source !== 'online'} onChange={e => { const value = Number(e.target.value) as 0.25 | 0.5 | 1 | 2 | 4; simControl.setSpeed(value); }}>{[0.25, 0.5, 1, 2, 4].map(n => <option key={n} value={n}>{n}×</option>)}</select><button disabled={source !== 'online'} aria-label="Simülasyonu sıfırla" title="Mevcut motoru sıfırla" onClick={() => simControl.reset()}><Icon name="reset"/></button></div><div className="ww-toolbar-links"><button title="Depoya genel bakış" aria-label="Genel depo görünümü" onClick={resetCamera}><Icon name="home"/></button><a href="#shop">Mağaza ↗</a></div></header>;
}
