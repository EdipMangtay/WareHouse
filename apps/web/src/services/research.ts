import type { CommandPayload, CreateSession, SessionFrame } from '../../../../packages/contracts/research';
const env = (import.meta as unknown as {
    env: Record<string, string | undefined>;
}).env;
const configured = env?.VITE_API_URL;
const base = configured ?? (env?.VITE_WS_URL?.replace(/^ws/, 'http').replace(/\/ws$/, '') ?? '');
export const researchUrl = (path: string) => `${base}/api/research${path}`;
async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(researchUrl(path), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail));
    }
    return response.status === 204 ? undefined as T : response.json();
}
export const researchApi = {
    catalog: () => request<{
        scenarios: string[];
        policies: string[];
    }>('/catalog'),
    create: (body: CreateSession) => request<SessionFrame>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
    state: (id: string) => request<SessionFrame>(`/sessions/${id}`),
    command: (id: string, command: CommandPayload) => request<SessionFrame>(`/sessions/${id}/commands`, { method: 'POST', body: JSON.stringify({ ...command, command_id: crypto.randomUUID() }) }),
    close: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
};
/** Reconnect resumes the SAME server session; it never creates a local simulation. */
export function researchStream(id: string, onFrame: (frame: SessionFrame) => void, onConnection: (online: boolean) => void) {
    let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
    const open = () => {
        if (stopped) return;
        onConnection(false);
        const url = new URL(researchUrl(`/sessions/${id}/stream`), window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(url);
        socket.onopen = () => onConnection(true);
        socket.onmessage = event => { try {
            const frame = JSON.parse(event.data);
            if (frame.type === 'SNAPSHOT' && frame.state?.schema_version === '2.0')
                onFrame(frame);
        }
        catch {
            onConnection(false);
        } };
        socket.onclose = () => { onConnection(false); if (!stopped)
            timer = setTimeout(open, 1500); };
    };
    timer = setTimeout(open, 0);
    return () => { stopped = true; clearTimeout(timer); if (socket) {
        socket.onclose = null;
        socket.onmessage = null;
        if (socket.readyState === WebSocket.CONNECTING) {
            const pending = socket;
            pending.onopen = () => pending.close();
        } else socket.close();
    } };
}
