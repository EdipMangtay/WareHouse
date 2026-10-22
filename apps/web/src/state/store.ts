import { create } from "zustand";
import layoutJson from "../layout/active_layout.json";
import type { WarehouseLayout, LayoutLocation, NavigationSnapshot } from "../layout/types";
import type { TwinState, RobotId, HeatmapLayer } from "../schema/twin_state";

import type { CameraMode, SceneSelection, LayerKey } from "../components/scene/experience";

export type ViewTab = "3D" | "MAP" | "TRAFFIC" | "HEATMAP";
export type Quality = "low" | "medium" | "high";
export type SceneTool = "select" | "pan" | "paths" | "labels" | "measure";
export interface CameraSettings { walkSpeed: number; sensitivity: number; fov: number; exposure: number; cutaway: boolean }

export const layout = layoutJson as unknown as WarehouseLayout;

interface Store {
  navigation: NavigationSnapshot | null;
  setNavigation: (navigation: NavigationSnapshot | null) => void;
  twin: TwinState;
  /** layout.locations 以 id 索引 */
  locations: Record<string, LayoutLocation>;
  selectedRobot: RobotId | null;
  selection: SceneSelection | null;
  hovered: SceneSelection | null;
  inspect: (selection: SceneSelection | null) => void;
  hover: (hovered: SceneSelection | null) => void;
  layers: Record<LayerKey, boolean>;
  toggleLayer: (key: LayerKey) => void;
  focusSize: [number, number, number] | null;
  frame: (center: [number, number, number], size: [number, number, number]) => void;
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;
  cameraSettings: CameraSettings;
  setCameraSettings: (settings: Partial<CameraSettings>) => void;
  walkTarget: [number, number] | null;
  enterWalk: (point?: [number, number]) => void;
  walkPose: { x: number; z: number; yaw: number } | null;
  setWalkPose: (pose: { x: number; z: number; yaw: number }) => void;
  walkCaptured: boolean;
  setWalkCaptured: (captured: boolean) => void;
  viewTab: ViewTab;
  quality: Quality;
  showPaths: boolean;
  showLabels: boolean;
  tool: SceneTool;
  focusTarget: [number, number, number] | null;
  activeCamera: string;
  select: (id: RobotId | null) => void;
  setViewTab: (t: ViewTab) => void;
  setQuality: (q: Quality) => void;
  setTool: (t: SceneTool) => void;
  togglePaths: () => void;
  toggleLabels: () => void;
  focus: (p: [number, number, number] | null) => void;
  setActiveCamera: (id: string) => void;
  /** 模擬控制（Phase 2 本地；Phase 3 改送 SIM_CONTROL） */
  speed: 0 | 0.25 | 0.5 | 1 | 2 | 4 | 5 | 10;
  paused: boolean;
  seed: number;
  setSpeed: (v: 0 | 0.25 | 0.5 | 1 | 2 | 4 | 5 | 10) => void;
  setPaused: (p: boolean) => void;
  /** 每 tick 由 runner (本地) 或 WebSocket (online) 呼叫 */
  setTwin: (t: TwinState) => void;
  /** 資料來源：online = 後端 WebSocket；local = 前端引擎 fallback */
  source: "connecting" | "online" | "offline";
  setSource: (s: "connecting" | "online" | "offline") => void;
  /** 後端送來的熱圖層（online 時）；local 時從本地引擎讀 */
  /** 遠端熱圖層，key = `${kind}:${floor}`（每樓獨立） */
  heat: Record<string, HeatmapLayer> | null;
  setHeat: (l: HeatmapLayer | null) => void;
  /** Phase 4 UI：Modal / 抽屜 */
  modal: null | "audit" | "tasks" | "robot" | "fleet";
  setModal: (m: null | "audit" | "tasks" | "robot" | "fleet") => void;
  /** 短暫提示（例如後端回 RATE_LIMITED）；null = 不顯示 */
  notice: { text: string; kind: "warn" | "info"; until: number } | null;
  setNotice: (text: string | null, kind?: "warn" | "info") => void;
  /** 3D / Map 顯示的樓層："all" = 疊起來全顯示 */
  /** "exploded" = 二樓視覺上抬高 5 m（僅 render transform，不動模擬座標） */
  activeFloor: "all" | "exploded" | number;
  setActiveFloor: (f: "all" | "exploded" | number) => void;
  /** 點選的電梯（右欄顯示 Lift 面板；與 selectedRobot 互斥） */
  selectedLift: string | null;
  selectLift: (id: string | null) => void;
  drawer: null | "scenarios" | "ops" | "whatif";
  setDrawer: (d: null | "scenarios" | "ops" | "whatif") => void;
  /** 最近一次 What-if 結果（後端回傳，含 schema 外的 window 對照資料） */
  whatif: unknown | null;
  setWhatIf: (r: unknown | null) => void;
}

/** 空的初始 TwinState（runner 掛載後立刻被引擎快照取代） */
const EMPTY: TwinState = {
  schema_version: "1.0", layout_id: layout.id,
  sim: { tick: 0, tick_ms: 100, speed: 1, mode: "PAUSED", seed: 42, baseline_snapshot_id: null },
  robots: {}, tasks: {}, lifts: {}, zones: {}, conveyors: {}, cameras: {}, sensors: {}, people: {}, alerts: {}, recent_events: [], recent_decisions: [],
  kpi: { tick: 0, fleet: { total: 0, active: 0, charging: 0, idle: 0, warning: 0, error: 0, offline: 0 }, operation: { throughput_per_min: 0, completed_today: 0, completed_target: 150, pending: 0, ongoing: 0, avg_task_time_s: 0, on_time_rate: 1, avg_utilization: 0 }, efficiency: { avg_travel_distance_m: 0, avg_wait_time_s: 0, congestion_index: 0, energy_kwh: 0 }, throughput_series: [], lifts: { trips: 0, utilization: 0, avg_wait_s: 0, faults: 0 } },
  subsystems: { WAREHOUSE: "NORMAL", CONVEYORS: "NORMAL", CHARGING: "NORMAL", CCTV: "NORMAL", NETWORK: "NORMAL" },
};

export const useStore = create<Store>((set) => ({
  twin: EMPTY,
  navigation:null, setNavigation:(navigation)=>set({navigation}),
  speed: 1, paused: false, seed: 42,
  source: "connecting",
  setSource: (source) => set({ source }),
  modal: null,
  setModal: (modal) => set({ modal }),
  notice: null,
  setNotice: (text, kind = "warn") => set({ notice: text ? { text, kind, until: Date.now() + 4000 } : null }),
  activeFloor: "all",
  setActiveFloor: (activeFloor) => set({ activeFloor }),
  selectedLift: null,
  selectLift: (selectedLift) => set(selectedLift ? { selectedLift, selectedRobot: null, selection: null } : { selectedLift }),
  whatif: null,
  setWhatIf: (whatif) => set({ whatif }),
  drawer: null,
  setDrawer: (drawer) => set((st) => ({ drawer: st.drawer === drawer ? null : drawer })),
  heat: null,
  setHeat: (l) => set((st) => (l === null ? { heat: null } : { heat: { ...(st.heat ?? {}), [`${l.kind}:${l.floor ?? 1}`]: l } })),
  setSpeed: (speed) => set({ speed }),
  setPaused: (paused) => set({ paused }),
  locations: Object.fromEntries(layout.locations.map((l) => [l.id, l])),
  selection: null, hovered: null,
  inspect: (selection) => set(s => ({ selection, selectedRobot: selection?.kind === 'robot' ? selection.id : null, selectedLift: null, cameraMode: selection?.kind !== 'robot' && ['first','third'].includes(s.cameraMode) ? 'orbit' : s.cameraMode })),
  hover: (hovered) => set(s => s.hovered?.id === hovered?.id && s.hovered?.kind === hovered?.kind ? s : {hovered}),
  layers: {status:true,corridors:false,zones:true,stations:false,obstacles:false,traffic:false,grid:false,graph:false,access:false,junctions:false,closures:false},
  toggleLayer: (key) => set(s=>({layers:{...s.layers,[key]:!s.layers[key]}})),
  focusSize: null,
  frame: (focusTarget, focusSize) => set({focusTarget,focusSize}),
  selectedRobot: null,
  cameraMode: "orbit",
  setCameraMode: (cameraMode) => set(cameraMode === 'walk'
    ? { cameraMode, viewTab:'3D', activeFloor:1, focusTarget:null, focusSize:null }
    : ["cinematic","top","isometric"].includes(cameraMode) ? { cameraMode, focusTarget:null, focusSize:null } : { cameraMode }),
  cameraSettings: { walkSpeed: 3, sensitivity: 1, fov: 68, exposure: 1.12, cutaway: true },
  setCameraSettings: (next) => set(s => {
    const settings = { ...s.cameraSettings, ...next };
    for (const [key, min, max] of [['walkSpeed',1,8],['sensitivity',.3,2],['fov',45,90],['exposure',.7,1.6]] as const) {
      settings[key] = Number.isFinite(settings[key]) ? Math.min(max,Math.max(min,settings[key])) : s.cameraSettings[key];
    }
    return { cameraSettings: settings };
  }),
  walkTarget: null,
  enterWalk: (point) => set({ cameraMode:'walk', activeFloor:1, viewTab:'3D', walkTarget:point ? [...point] : null, focusTarget:null, focusSize:null }),
  walkPose: null, setWalkPose: (walkPose) => set({walkPose}),
  walkCaptured: false, setWalkCaptured: (walkCaptured) => set({walkCaptured}),
  viewTab: "3D",
  quality: "medium",
  showPaths: true,
  showLabels: true,
  tool: "select",
  focusTarget: null,
  activeCamera: "CAM-B01",
  select: (id) => set({ selectedRobot: id, selectedLift: null, selection: id ? {kind:"robot",id} : null }),
  setViewTab: (viewTab) => set({ viewTab }),
  setQuality: (quality) => set({ quality }),
  setTool: (tool) => set({ tool }),
  togglePaths: () => set((s) => ({ showPaths: !s.showPaths })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  focus: (focusTarget) => set({ focusTarget, focusSize: null }),
  setActiveCamera: (activeCamera) => set({ activeCamera }),
  setTwin: (twin) => set({ twin }),
}));

/** 狀態 → 顏色，全 App 共用 */
export const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#22c55e", CHARGING: "#3b82f6", IDLE: "#eab308", WARNING: "#f97316", ERROR: "#ef4444", OFFLINE: "#6b7280",
};
export const SEVERITY_COLOR: Record<string, string> = {
  INFO: "#3b82f6", LOW: "#3b82f6", MEDIUM: "#3b82f6", HIGH: "#eab308", CRITICAL: "#ef4444",
};
export const ZONE_COLOR = Object.fromEntries(layout.zones.map((z) => [z.id, z.color]));

/** 模擬時鐘：tick 0 = 08:00:00 */
export const SIM_START_S = 8 * 3600;
export function tickToClock(tick: number, tickMs = 100, withSeconds = false): string {
  const s = Math.max(0, Math.floor(SIM_START_S + (tick * tickMs) / 1000));
  const hh = Math.floor(s / 3600) % 24, mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return withSeconds ? `${p(hh)}:${p(mm)}:${p(ss)}` : `${p(hh)}:${p(mm)}`;
}
