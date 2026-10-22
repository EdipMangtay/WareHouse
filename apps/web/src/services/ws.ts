/**
 * WebSocket client（Phase 3）
 *
 *  Backend → FULL / PATCH / HEATMAP / ERROR   →  store.twin / store.heat
 *  UI      → SIM_CONTROL / INJECT / CREATE_TASK / ACK_ALERT / RESYNC
 *
 * PATCH 合併規則（與 backend/app/main.py make_patch 對應）：
 *  - sim / kpi / subsystems / recent_decisions：整段取代
 *  - robots：每台 {...prev, ...patch}（path 只在變更時出現）
 *  - tasks / zones / conveyors / cameras / sensors / people / alerts：以 id 合併；值為 null 代表刪除
 *  - events：prepend 到 recent_events（ring 500）
 * 若 patch.base_tick 與本地 tick 不符 → 送 RESYNC 要 FULL。
 */
import type { ServerMessage, ClientMessage, TwinState, HeatmapLayer, RobotState } from "../schema/twin_state";
import { THRESHOLDS } from "../schema/twin_state";
import { layout, useStore } from "../state/store";

import { presentation } from "../simulation/presentation";

export type ConnState = "connecting" | "online" | "offline";

const WS_URL = (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_WS_URL ?? `ws://${location.hostname}:8000/ws`;
/** REST base（由 WS_URL 推導）：ws://host:8000/ws → http://host:8000 */
export const API_URL = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const COLLECTIONS = ["packages", "tasks", "lifts", "zones", "conveyors", "cameras", "sensors", "people", "alerts"] as const;

let socket: WebSocket | null = null;
let reconnectTimer = 0;
let stopped = false;
let localTick = -1;
// Merge every authoritative message, publish at most 20 times/sec. In accelerated
// simulations this avoids reconciling the whole console 100 times/sec.
let pendingTwin: TwinState | null = null;
let publishTimer = 0;
function publishPending() {
  publishTimer = 0;
  if (!pendingTwin) return;
  const next = pendingTwin; pendingTwin = null;
  useStore.getState().setTwin(next); syncControls(next);
}
let onStateChange: ((s: ConnState) => void) | null = null;
type CopilotReply = { request_id: string; text: string; citations: Array<{ robot_id?: string; task_id?: string; event_id?: string }>; model?: string };
const copilotListeners = new Set<(r: CopilotReply) => void>();
/** 訂閱 COPILOT_REPLY；回傳取消函式 */
export function onCopilotReply(fn: (r: CopilotReply) => void): () => void { copilotListeners.add(fn); return () => copilotListeners.delete(fn); }
const whatifListeners = new Set<(r: unknown) => void>();
export function onWhatIfResult(fn: (r: unknown) => void): () => void { whatifListeners.add(fn); return () => whatifListeners.delete(fn); }
const whatifErrorListeners = new Set<(message: string, request_id: string | null) => void>();
/** 後端對 WHATIF_RUN 回 ERROR（RATE_LIMITED / BUSY / BAD_MESSAGE…）時通知，讓抽屜解除 Simulating 狀態 */
export function onWhatIfError(fn: (message: string, request_id: string | null) => void): () => void { whatifErrorListeners.add(fn); return () => whatifErrorListeners.delete(fn); }
const whatifProgressListeners = new Set<(done: number, total: number, request_id: string | null) => void>();
/** round-10：多 seed What-if 每跑完一對就收到一次 WHATIF_PROGRESS */
export function onWhatIfProgress(fn: (done: number, total: number, request_id: string | null) => void): () => void { whatifProgressListeners.add(fn); return () => whatifProgressListeners.delete(fn); }
/** 正在等待結果的 What-if request_id（null = 沒有）；ERROR / WHATIF_RESULT 都要帶同一個 id 才會被當成它的回應 */
let whatifPending: string | null = null;
export function markWhatIfPending(id: string | null) { whatifPending = id; }

export function wsSend(msg: ClientMessage): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(msg)); return true; }
  return false;
}

// 分頁從背景回到前景：累積的 PATCH 可能被瀏覽器節流，直接要一份 FULL 最省事（具名 listener 才能在 disconnect 時移除）
const onVisible = () => { if (document.visibilityState === "visible") { clearTimeout(publishTimer); publishTimer=0; pendingTwin=null; localTick = -1; wsSend({ type: "RESYNC" }); } };
function closeSocket() {
  if (!socket) return;
  const previous = socket; socket = null;
  previous.onclose = null; previous.onmessage = null;
  if (previous.readyState === WebSocket.CONNECTING) previous.onopen = () => previous.close();
  else previous.close();
}
const onNetworkOffline = () => {
  clearTimeout(reconnectTimer); clearTimeout(publishTimer); publishTimer = 0;
  publishPending(); localTick = -1; closeSocket(); presentation.reset(useStore.getState().twin); onStateChange?.('offline');
};
const onNetworkOnline = () => { if (!stopped) { clearTimeout(reconnectTimer); closeSocket(); localTick = -1; open(); } };

export function wsConnect(onChange: (s: ConnState) => void) {
  wsDisconnect();                       // 重複呼叫（StrictMode 雙掛載）時先把前一條連線收掉
  stopped = false; onStateChange = onChange;
  onStateChange?.("connecting");
  reconnectTimer = window.setTimeout(open, 0); // StrictMode cleanup can cancel before opening a socket.
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener?.('offline', onNetworkOffline);
  window.addEventListener?.('online', onNetworkOnline);
}
export function wsDisconnect() {
  clearTimeout(publishTimer); publishTimer = 0; pendingTwin = null;
  presentation.reset();
  stopped = true; clearTimeout(reconnectTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener?.('offline', onNetworkOffline);
  window.removeEventListener?.('online', onNetworkOnline);
  closeSocket();
  onStateChange = null; localTick = -1;
}

function open() {
  if (stopped) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { onStateChange?.('offline'); return; }
  onStateChange?.("connecting");
  let ws: WebSocket;
  try {
    // https 頁面開 ws:// 會同步丟 SecurityError（沒設 VITE_WS_URL 時），要接住，否則整個 App 掛掉
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn("[ws] cannot open", WS_URL, e, "— showing the last confirmed snapshot");
    onStateChange?.("offline");
    return;
  }
  socket = ws;
  const timeout = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 2500);
  ws.onopen = () => { clearTimeout(timeout); onStateChange?.("online"); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data) as ServerMessage);
  ws.onerror = () => { /* onclose 會處理 */ };
  ws.onclose = () => {
    clearTimeout(timeout);
    if (socket === ws) socket = null;
    if (whatifPending) { const id = whatifPending; whatifPending = null; whatifErrorListeners.forEach((fn) => fn("connection lost — please run again", id)); }
    clearTimeout(publishTimer); publishTimer = 0; publishPending();
    presentation.reset(useStore.getState().twin);
    onStateChange?.("offline");
    if (!stopped) reconnectTimer = window.setTimeout(open, 3000);
  };
}

function handle(msg: ServerMessage) {
  const st = useStore.getState();
  switch (msg.type) {
    case "FULL": {
      if (layout.revision && msg.layout_revision !== layout.revision) {
        wsDisconnect(); st.setSource('offline');
        st.setNotice('Depo yerleşimleri eşleşmiyor. Backend ve arayüzü aynı boyutla start.sh üzerinden yeniden başlatın.', 'warn');
        return;
      }
      localTick = msg.state.sim.tick;
      clearTimeout(publishTimer); publishTimer = 0; pendingTwin = null;
      presentation.reset(msg.state);
      st.setTwin(msg.state); syncControls(msg.state);
      break;
    }
    case "PATCH": {
      if (localTick < 0) return; // Await FULL after a gap/visibility resync.
      if (localTick >= 0 && msg.base_tick !== localTick && msg.base_tick !== msg.tick) {
        // 漏掉了 tick（例如分頁休眠），要求全量重送
        clearTimeout(publishTimer); publishTimer=0; pendingTwin=null;
        localTick = -1; wsSend({ type: "RESYNC" }); return;
      }
      localTick = msg.tick;
      pendingTwin = applyPatch(pendingTwin ?? st.twin, msg);
      presentation.push(pendingTwin);
      if (!publishTimer) publishTimer = window.setTimeout(publishPending, 50);
      break;
    }
    case "HEATMAP": st.setHeat(msg.layer); break;
    case "COPILOT_REPLY": copilotListeners.forEach((fn) => fn(msg as unknown as CopilotReply)); break;
    case "WHATIF_RESULT": if (!msg.request_id || msg.request_id === whatifPending) whatifPending = null; whatifListeners.forEach((fn) => fn(msg.result)); break;
    case "WHATIF_PROGRESS": whatifProgressListeners.forEach((fn) => fn(msg.done, msg.total, msg.request_id ?? null)); break;
    case "ERROR": {
      console.warn("[ws] server error", msg.code, msg.message);
      st.setNotice(`İşlem uygulanmadı (${msg.code}): ${msg.message}`);
      if (msg.code === "RATE_LIMITED" || msg.code === "TOO_LARGE" || msg.code === "BAD_TASK" || msg.code === "BAD_MESSAGE" || msg.code === "BUSY") {
        // Copilot 等待中的泡泡也要收掉
        const rid = (msg as unknown as { request_id?: string }).request_id;
        if (rid) copilotListeners.forEach((fn) => fn({ request_id: rid, text: `⏳ ${msg.message}`, citations: [] }));
        // 只有 request_id 等於正在等待的 What-if 才算它的錯誤（其他錯誤例如 BAD_TASK 不會誤關 Simulating）
        if (whatifPending && rid === whatifPending) { const id = whatifPending; whatifPending = null; whatifErrorListeners.forEach((fn) => fn(msg.message, id)); }
      }
      break;
    }
    default: break;
  }
}

/** 後端是權威：播放/暫停/倍速以 sim 欄位為準（例如另一個分頁按了暫停） */
function syncControls(t: TwinState) {
  const st = useStore.getState();
  if (st.speed !== t.sim.speed) st.setSpeed(t.sim.speed);
  const paused = t.sim.mode === "PAUSED";
  if (st.paused !== paused) st.setPaused(paused);
}

type Patch = Extract<ServerMessage, { type: "PATCH" }>;

export function applyPatch(prev: TwinState, msg: Patch): TwinState {
  const p = msg.patch as Record<string, unknown>;
  const next: TwinState = { ...prev };
  if (p.sim) next.sim = { ...prev.sim, ...(p.sim as TwinState["sim"]) };
  if (p.conveyor_system) next.conveyor_system = { ...prev.conveyor_system, ...p.conveyor_system as TwinState["conveyor_system"] } as TwinState["conveyor_system"];
  if (p.kpi) next.kpi = p.kpi as TwinState["kpi"];
  if (p.subsystems) next.subsystems = p.subsystems as TwinState["subsystems"];
  if (p.recent_decisions) next.recent_decisions = p.recent_decisions as TwinState["recent_decisions"];
  if (p.robots) {
    const robots = { ...prev.robots };
    for (const [id, d] of Object.entries(p.robots as Record<string, Partial<RobotState>>)) robots[id] = { ...robots[id], ...d } as RobotState;
    next.robots = robots;
  }
  for (const key of COLLECTIONS) {
    const d = p[key] as Record<string, unknown> | undefined;
    if (!d) continue;
    const col = { ...(prev[key] as Record<string, unknown>) };
    for (const [id, v] of Object.entries(d)) { if (v === null) delete col[id]; else col[id] = v; }
    (next as unknown as Record<string, unknown>)[key] = col;
  }
  if (msg.events.length) next.recent_events = [...msg.events.slice().reverse(), ...prev.recent_events].slice(0, THRESHOLDS.EVENT_RING_SIZE);
  return next;
}

export type { HeatmapLayer };
