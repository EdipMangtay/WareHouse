import { useEffect } from 'react';
import { api } from '../commerce/api';
import { useStore } from '../state/store';
import { useWarehouseOperations, type WarehouseOperations } from '../state/warehouseOperations';
/** Reads the existing commerce service; no alternate simulator and no local order transitions. */
export function useWarehouseOperationsFeed() {
    const source = useStore(s => s.source);
    useEffect(() => {
        if (source !== 'online') return;
        let stopped = false, timer: ReturnType<typeof setTimeout>;
        let controller: AbortController | null = null;
        async function refresh() {
            controller = new AbortController();
            const request = controller;
            const timeout = setTimeout(() => request.abort(), 8000);
            try { const data = await api<WarehouseOperations>('/admin', { signal: request.signal }); if (!stopped) useWarehouseOperations.getState().setData(data); }
            catch (e) { if (!stopped) useWarehouseOperations.getState().setError(request.signal.aborted ? 'Sipariş isteği zaman aşımına uğradı.' : (e as Error).message); }
            finally { clearTimeout(timeout); }
            if (!stopped) timer = setTimeout(refresh, 1200);
        }
        refresh();
        return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
    }, [source]);
}
