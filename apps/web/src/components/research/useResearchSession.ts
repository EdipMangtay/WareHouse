import { useEffect, useState } from 'react';
import type { CommandPayload, CreateSession } from '../../../../../packages/contracts/research';
import { researchApi, researchStream } from '../../services/research';
import { useResearch } from '../../state/research';
export function useResearchSession() {
    const frame = useResearch(s => s.frame), connected = useResearch(s => s.connected);
    const [scenarios, setScenarios] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => {
        let alive = true;
        researchApi.catalog().then(v => { if (alive) setScenarios(v.scenarios); }).catch(e => { if (alive) setError(`API bağlantısı kurulamadı: ${e.message}`); });
        const sid = sessionStorage.getItem('waretwin-research-session');
        if (sid && !useResearch.getState().frame) researchApi.state(sid).then(f => { if (alive) useResearch.getState().replace(f); }).catch(() => { if (alive) { sessionStorage.removeItem('waretwin-research-session'); setError('Önceki oturum bulunamadı. Yeni bir oturum oluşturabilirsiniz.'); } }).finally(() => { if (alive) setLoading(false); });
        else setLoading(false);
        return () => { alive = false; };
    }, []);
    useEffect(() => { if (frame?.session_id) return researchStream(frame.session_id, useResearch.getState().apply, useResearch.getState().setConnected); }, [frame?.session_id]);
    async function create(config: CreateSession) {
        if (busy) return false;
        setBusy(true); setError('');
        try {
            const next = await researchApi.create(config);
            if (frame) await researchApi.close(frame.session_id).catch(() => {});
            useResearch.getState().replace(next);
            sessionStorage.setItem('waretwin-research-session', next.session_id);
            return true;
        } catch (e) { setError((e as Error).message); return false; }
        finally { setBusy(false); }
    }
    async function send(command: CommandPayload) {
        if (!frame || !connected || busy) return false;
        setBusy(true); setError('');
        try { useResearch.getState().apply(await researchApi.command(frame.session_id, command)); return true; }
        catch (e) { setError((e as Error).message); return false; }
        finally { setBusy(false); }
    }
    return { frame, connected, scenarios, busy, loading, error, setError, create, send };
}
export type ResearchSession = ReturnType<typeof useResearchSession>;
