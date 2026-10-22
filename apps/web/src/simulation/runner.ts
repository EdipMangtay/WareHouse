/** Backend-only commands and snapshots. No browser operation engine takes over on disconnect. */
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { wsConnect, wsDisconnect, wsSend } from '../services/ws';
import type { ClientMessage, ScenarioInjection, TaskPriority, TaskType } from '../schema/twin_state';
function send(message: ClientMessage) {
    if (useStore.getState().source !== 'online' || !wsSend(message)) {
        useStore.getState().setNotice('Backend bağlantısı yok. İşlem uygulanmadı; son doğrulanmış durum gösteriliyor.');
    }
}
export const simControl = {
    play(speed?: 0.25 | 0.5 | 1 | 2 | 4 | 5 | 10) { const current = useStore.getState().speed; send({ type: 'SIM_CONTROL', action: 'PLAY', speed: speed ?? (current === 0 ? 1 : current) }); },
    setSpeed(speed: Exclude<ReturnType<typeof useStore.getState>['speed'], 0>) { send({ type: 'SIM_CONTROL', action: useStore.getState().paused ? 'PAUSE' : 'PLAY', speed }); },
    pause() { send({ type: 'SIM_CONTROL', action: 'PAUSE' }); },
    reset() { send({ type: 'SIM_CONTROL', action: 'RESET' }); },
    inject(injection: ScenarioInjection) { send({ type: 'INJECT', injection }); },
    createTask(task: {
        type: TaskType;
        priority: TaskPriority;
        source: string;
        destination: string;
        load_units?: number;
    }) { send({ type: 'CREATE_TASK', task: { load_units: 1, ...task } }); },
    clearInjection(kind: ScenarioInjection['kind'], target_id: string) { send({ type: 'CLEAR_INJECTION', kind, target_id }); },
    ackAlert(alert_id: string) { send({ type: 'ACK_ALERT', alert_id }); },
};
export function useSimulationRunner() {
    useEffect(() => {
        wsConnect(conn => {
            const store = useStore.getState();
            store.setSource(conn === 'online' ? 'online' : conn === 'offline' ? 'offline' : 'connecting');
            if (conn === 'offline')
                store.setPaused(true);
        });
        return wsDisconnect;
    }, []);
}
