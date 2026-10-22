import { afterEach, expect, it, vi } from 'vitest';
import type { SessionFrame } from '../../../packages/contracts/research';
import { acceptsFrame, useResearch } from '../src/state/research';
import { useStore } from '../src/state/store';
const send = vi.fn(() => true);
vi.mock('../src/services/ws', () => ({ wsSend: (m: unknown) => send(m), wsConnect: vi.fn(), wsDisconnect: vi.fn() }));
afterEach(() => { send.mockClear(); useResearch.setState({ frame: null }); });
it('cannot let delayed responses or a replaced session overwrite authoritative state', () => {
    const frame = { session_id: 'one', revision: 5, generation: 0, state: { tick: 40 } } as SessionFrame;
    useResearch.getState().replace(frame);
    useResearch.getState().apply({ ...frame, revision: 4, state: { tick: 30 } } as SessionFrame);
    expect(useResearch.getState().frame?.state.tick).toBe(40);
    expect(acceptsFrame(frame, { ...frame, session_id: 'other', revision: 100 })).toBe(false);
    useResearch.getState().apply({ ...frame, revision: 6, generation: 1, state: { tick: 0 } } as SessionFrame);
    expect(useResearch.getState().frame?.state.tick).toBe(0);
    expect(useResearch.getState().frame?.generation).toBe(1);
});
it('legacy controls send commands and cannot independently advance or reset operations', async () => {
    const { simControl } = await import('../src/simulation/runner');
    const snapshot = structuredClone(useStore.getState().twin);
    snapshot.sim.tick = 250;
    useStore.setState({ source: 'online', twin: snapshot, paused: false });
    simControl.pause();
    expect(send).toHaveBeenCalledWith({ type: 'SIM_CONTROL', action: 'PAUSE' });
    expect(useStore.getState().paused).toBe(false); // waits for server acknowledgement
    useStore.setState({ source: 'offline' });
    simControl.reset();
    simControl.play(10);
    expect(useStore.getState().twin.sim.tick).toBe(250);
    expect(send).toHaveBeenCalledTimes(1);
});
