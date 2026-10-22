import { create } from 'zustand';
import type { SessionFrame } from '../../../../packages/contracts/research';
import type { Selection, SceneLayers } from '../components/research/presentation';
export function acceptsFrame(current: SessionFrame | null, next: SessionFrame) {
    return !current || (current.session_id === next.session_id && next.revision >= current.revision);
}
interface ResearchStore {
    frame: SessionFrame | null;
    connected: boolean;
    selection: Selection | null;
    camera: { mode: 'overview' | 'top' | 'focus' | 'follow'; target: Selection | null; revision: number };
    layers: SceneLayers;
    lastReceivedAt: number | null;
    apply: (frame: SessionFrame) => void;
    replace: (frame: SessionFrame) => void;
    setConnected: (connected: boolean) => void;
    selectOrder: (id: string | null) => void;
    selectRobot: (id: string | null) => void;
    select: (selection: Selection | null) => void;
    focus: (target: Selection | null, mode?: 'overview' | 'top' | 'focus' | 'follow') => void;
    setLayer: (key: keyof SceneLayers, value: boolean) => void;
}
export const useResearch = create<ResearchStore>((set) => ({
    frame: null, connected: false, selection: null, lastReceivedAt: null,
    camera: { mode: 'overview', target: null, revision: 0 },
    layers: { labels: true, racks: true, gaps: false, reservations: false },
    apply: next => set(s => acceptsFrame(s.frame, next) ? { frame: next, lastReceivedAt: Date.now(), ...(s.frame?.generation !== next.generation ? { selection: null } : {}) } : {}),
    replace: frame => set(s => ({ frame, selection: null, connected: false, lastReceivedAt: Date.now(), camera: { mode: 'overview', target: null, revision: s.camera.revision + 1 } })),
    setConnected: connected => set({ connected }),
    select: selection => set({ selection }),
    selectOrder: id => set({ selection: id ? { kind: 'order', id } : null }),
    selectRobot: id => set({ selection: id ? { kind: 'robot', id } : null }),
    focus: (target, mode = 'focus') => set(s => ({ camera: { target, mode, revision: s.camera.revision + 1 } })),
    setLayer: (key, value) => set(s => ({ layers: { ...s.layers, [key]: value } })),
}));
