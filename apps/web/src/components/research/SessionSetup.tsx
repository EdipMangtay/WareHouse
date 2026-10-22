import { useEffect, useState } from 'react';
import type { Policy } from '../../../../../packages/contracts/research';
import type { ResearchSession } from './useResearchSession';
import { useFocusTrap } from '../ui/useFocusTrap';
import { Icon } from './Icon';
import { POLICY_NAMES, SCENARIO_NAMES } from './presentation';
export function SessionSetup({ session, close }: { session: ResearchSession; close: () => void }) {
    const state = session.frame?.state;
    const [scenario, setScenario] = useState(state?.scenario ?? 'multi_zone'), [policy, setPolicy] = useState<Policy>(state?.policy ?? 'fifo');
    const [seed, setSeed] = useState(state?.scenario_seed ?? 42), [algorithmSeed, setAlgorithmSeed] = useState(state?.algorithm_seed ?? 7), [budget, setBudget] = useState(12);
    const trap = useFocusTrap<HTMLDivElement>(true);
    useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !session.busy) close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close, session.busy]);
    return <div className="wt-modal-backdrop"><div ref={trap} className="wt-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div className="wt-panel-heading"><span className="wt-eyebrow">DENEY YAPILANDIRMASI</span><button className="wt-icon-button" aria-label="Yapılandırmayı kapat" disabled={session.busy} onClick={close}><Icon name="close"/></button></div>
        <h2 id="setup-title">Operasyonu hazırla.</h2><p>Aynı fiziksel depo, farklı talep ve kaynak koşulları.</p>
        <form onSubmit={async e => { e.preventDefault(); if (await session.create({ scenario, policy, scenario_seed: seed, algorithm_seed: algorithmSeed, search_budget: budget })) close(); }}>
            <label>Senaryo<select value={scenario} onChange={e => setScenario(e.target.value)}>{(session.scenarios.length ? session.scenarios : Object.keys(SCENARIO_NAMES)).map(s => <option key={s} value={s}>{SCENARIO_NAMES[s] ?? s}</option>)}</select></label>
            <label>Karar yöntemi<select value={policy} onChange={e => setPolicy(e.target.value as Policy)}>{Object.entries(POLICY_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <div className="wt-form-grid"><label>Senaryo tohumu<input type="number" required value={seed} onChange={e => setSeed(Number(e.target.value))}/></label><label>Algoritma tohumu<input type="number" required value={algorithmSeed} onChange={e => setAlgorithmSeed(Number(e.target.value))}/></label><label>Aday bütçesi<input type="number" min={1} max={128} required value={budget} onChange={e => setBudget(Number(e.target.value))}/></label></div>
            {session.error && <p role="alert" className="wt-error-text">{session.error}</p>}
            <p className="wt-muted">{state ? 'Önceki oturum arşivlenir. ' : ''}Yeni oturum duraklatılmış olarak açılır. Zamanlar simülasyon saniyesidir.</p>
            <button className="wt-primary wt-wide" disabled={session.busy}>{session.busy ? 'Oturum hazırlanıyor…' : 'Oturum oluştur'}<Icon name="arrow"/></button>
        </form>
    </div></div>;
}
