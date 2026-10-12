/** warehouse_layout.json 的型別，對應 docs/layout/warehouse_layout_格式說明.md */
export type P2 = [number, number];
export type P3 = [number, number, number];
export type Rect = [number, number, number, number];

export interface LayoutZone { id: string; name: string; color: string; polygon: P2[]; floor?: number }
export interface LayoutDock { id: string; kind: "INBOUND" | "OUTBOUND"; zone: string; rect: Rect; door: P2 }
export interface LayoutRack { id: string; zone: string; position: P3; size: P3; rotation: number; levels: number; model: string; blocks_grid: boolean; floor?: number }
export interface LayoutConveyor { placement?: 'exterior'; role?: 'perimeter'|'induction'|'exit'; next?: string[]; length_m?:number; capacity?:number; pitch_m?:number; id: string; name: string; zone: string; path: P2[]; width: number; speed_mps: number; direction: string; blocks_grid: boolean; /** 這條輸送帶供應的工作站；故障時該站的卸貨時間變長 */ feeds?: string }
export interface LayoutStation { id: string; kind: string; zone: string; rect: Rect; access_point: P2 }
export interface LayoutCharging { id: string; zone: string; position: P3; heading: number; power_kw: number; access_point: P2 }
export interface LayoutParking { id: string; zone: string; rect: Rect; slots: number }
export interface LayoutRestricted { id: string; name: string; rect: Rect; robots_allowed: boolean }
export interface LayoutWalkway { id: string; polygon: P2[]; robots_allowed: boolean; speed_limit_mps: number }
export interface LayoutCamera { id: string; zone: string; floor?: number; position: P3; look_at: P3; fov_deg: number; range_m: number }
export interface LayoutSensor { id: string; kind: string; zone: string; position: P3 }
export interface LayoutLocation { id: string; kind: string; zone: string; floor?: number; rack_id: string | null; level_range: [number, number] | null; access_point: P2 }
export interface LayoutSpawnRobot { id: string; position: P3; heading: number; battery: number; floor?: number }
export interface LayoutFloor { id: number; name: string; elevation: number; footprint?: P2[] }
export interface LayoutLift { id: string; cell: [number, number]; floors: number[]; ride_ticks: number }

export interface NavigationCorridor { id:string; floor?:number; rect:Rect; mode:'one_way'|'two_way'; direction?:'+x'|'-x'|'+z'|'-z' }
export interface NavigationNode {id:string;kind:string;floor:number;zone:string|null;cell:P2;world:P2;valid:boolean}
export interface NavigationValidation {valid:boolean;errors:string[];floors:Record<string,{anchor:string|null;walkable_cells:number;forward_reachable:number;return_reachable:number;strongly_connected:boolean}>;invalid_nodes:string[];unreachable_nodes:string[];isolated_zones:string[]}
export interface NavigationGraph {version:number;cell_size:number;directions:P2[];floors:Record<string,{cols:number;rows:number;cells:number[];outgoing:number[];junctions:P2[];sha256:string}>;nodes:NavigationNode[];validation:NavigationValidation}
export interface NavigationSnapshot { layout_revision:string;revision:number;tick:number;floor:number;blocked_cells:P2[];manual_cells:P2[];blocked_edges:[P2,P2][];validation:NavigationValidation }
export interface WarehouseLayout {
  conveyor_network?: {version:number; placement?:'exterior'; perimeter_offset_m?:number; apron_bounds?:Rect; transfer_points?:Record<string,{wall:'north'|'south';position:P2;segment_id:string}>; induction_points:Record<string,{id:string;zone_id:string;segment_id:string;capacity:number;access_point:P2}>};
  navigation_graph?:NavigationGraph;
  revision?: string;
  navigation?: { robot_radius: number; clearance_padding: number; safety_margin?:number; corridors?:NavigationCorridor[] };
  metadata?: { preset: string; generator_version: string; config: Record<string, number | string>; counts: Record<string, number> };
  storage_slots?: Array<{ id: string; rack_id: string; location_id: string; level: number; bay: number; side: string | number }>;
  schema_version: string;
  id: string;
  name: string;
  units: string;
  size: { width: number; depth: number; height: number };
  grid: { cell_size: number; cols: number; rows: number };
  floors: LayoutFloor[];
  /** 夾層支撐柱位（立在 F1 地面）：F1 導航網格以柱底板 0.9×0.9 m 封成障礙 */
  columns?: Array<[number, number]>;
  lifts: LayoutLift[];
  zones: LayoutZone[];
  docks: LayoutDock[];
  racks: LayoutRack[];
  conveyors: LayoutConveyor[];
  stations: LayoutStation[];
  charging_stations: LayoutCharging[];
  parking: LayoutParking[];
  restricted_areas: LayoutRestricted[];
  walkways: LayoutWalkway[];
  cameras: LayoutCamera[];
  sensors: LayoutSensor[];
  locations: LayoutLocation[];
  /** 建築結構柱等實體障礙：F1 導航網格整塊封鎖；WarehouseShell 由此渲染柱子 */
  obstacles: Array<{ id: string; kind: string; rect: [number, number, number, number] }>;
  spawn: { robots: LayoutSpawnRobot[] };
}
