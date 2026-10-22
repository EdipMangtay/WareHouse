import { useEffect, useState } from 'react';
import type { ResearchSession } from './useResearchSession';
import { useResearch } from '../../state/research';
import { fmt, POLICY_NAMES, SCENARIO_NAMES } from './presentation';
import { Icon } from './Icon';
export function ResearchToolbar({ session, setup }: { session: ResearchSession; setup: () => void }) {
    const { frame, busy, connected, send } = session;
    const [speed, setSpeed] = useState(frame?.speed ?? 1);
    useEffect(() => { if (frame) setSpeed(frame.speed); }, [frame?.speed, frame?.session_id, frame?.generation]);
    const state = frame?.state;
    const disabled = busy || !connected || !frame;
    return <header className="wt-toolbar">
        <a className="wt-brand" href="#shop" aria-label="WareTwin mağazası"><span className="wt-brand-mark"><Icon name="cube" size={24}/></span><b>ware<span>twin</span><small>OPERASYON STÜDYOSU</small></b></a>
        <div className="wt-scenario"><strong>{state ? SCENARIO_NAMES[state.scenario] ?? state.scenario : 'Çok bölgeli depo'}</strong><span>{state ? POLICY_NAMES[state.policy] : 'Hazırlama · koordinasyon · sevkiyat'}</span></div>
        <div className="wt-playback" aria-label="Simülasyon kontrolleri">
            <div className="wt-time"><b>{fmt(state?.time_s ?? 0)}<small> s</small></b><span><i className={frame && !frame.paused && !state?.finished ? 'running' : ''}/>{!frame ? 'Oturum yok' : state?.finished ? 'Tamamlandı' : frame.paused ? 'Duraklatıldı' : 'Çalışıyor'}</span></div>
            <button className="wt-primary" disabled={disabled || state?.finished} onClick={() => send(frame?.paused ? { action: 'PLAY', speed } : { action: 'PAUSE' })}><Icon name={frame?.paused !== false ? 'play' : 'pause'} size={15}/>{frame?.paused !== false ? state?.tick ? 'Devam et' : 'Başlat' : 'Duraklat'}</button>
            <button className="wt-icon-button" title={`Bir adım · ${state?.tick_s ?? '—'} s`} aria-label="Bir adım" disabled={disabled || !frame?.paused || state?.finished} onClick={() => send({ action: 'STEP', ticks: 1 })}><Icon name="step"/></button>
            <button className="wt-skip" disabled={disabled || !frame?.paused || state?.finished} onClick={() => send({ action: 'STEP', ticks: 20 })}>+{fmt((state?.tick_s ?? .5) * 20)} s</button>
            <select aria-label="Simülasyon hızı" title="Yalnızca oynatma hızını değiştirir" value={speed} disabled={disabled || state?.finished} onChange={async e => { const next = Number(e.target.value); if (frame?.paused) setSpeed(next); else if (await send({ action: 'PLAY', speed: next })) setSpeed(next); }}>{[1, 2, 5, 10, 20].map(n => <option key={n} value={n}>{n}×</option>)}</select>
            <button className="wt-icon-button" title="Oturumu sıfırla" aria-label="Sıfırla" disabled={disabled} onClick={() => send({ action: 'RESET' })}><Icon name="reset"/></button>
        </div>
        <div className="wt-toolbar-end"><button className="wt-icon-button" title="Genel depo görünümü" aria-label="Genel depo görünümü" onClick={() => useResearch.getState().focus(null, 'overview')}><Icon name="home"/></button><button onClick={setup} className="wt-config-button"><Icon name="settings"/><span>Yapılandır</span></button></div>
    </header>;
}
