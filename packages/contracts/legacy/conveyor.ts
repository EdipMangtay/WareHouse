export interface Parcel {
  package_id:string; order_id:string; task_id:string; source_zone:string;
  destination_station:string; routing_destination:string; current_location:string;
  current_conveyor_segment:string|null; conveyor_position:number; velocity_mps?:number;
  package_dimensions:[number,number,number];
  status:'AWAITING_PICKUP'|'ON_ROBOT'|'WAITING_INDUCTION'|'LOADING'|'ON_CONVEYOR'|'DELIVERED';
  created_at:number;loaded_at:number|null;delivered_at:number|null;robot_id:string|null;
  handoff_started_at?:number|null;induction_station:string;route:string[];route_index:number;estimated_remaining_s:number|null;
  timeline:{tick:number;status:string;location:string}[];
}
export interface ConveyorSystem {
  metrics:{delivered:number;on_conveyor:number;waiting:number;occupancy:number;throughput_per_min:number;routing_errors:number};
  unloading_points:Record<string,{capacity:number;enabled:boolean;items:string[];reservations:Record<string,number>}>;
  routing_table:Record<string,string[]>;
  zones:Record<string,{zone_id:string;assigned_robots:string[];pending_tasks:string[];active_tasks:string[];induction_queue:string[];zone_operational_status:string}>;
}
export const PARCEL_STATUS:Record<string,string>={AWAITING_PICKUP:'Toplama bekliyor',ON_ROBOT:'Robot üzerinde',WAITING_INDUCTION:'Aktarım bekliyor',LOADING:'Yükleniyor',ON_CONVEYOR:'Konveyörde',DELIVERED:'Teslim doğrulandı',SCANNED:'Kimlik tarandı'};
