import type { WarehouseLayout } from '../../layout/types';
import type { TwinState } from '../../schema/twin_state';
export type CameraMode = 'cinematic' | 'top' | 'isometric' | 'orbit' | 'third' | 'first' | 'walk';
export type SceneSelection = { kind: 'robot' | 'rack' | 'zone' | 'station' | 'location' | 'conveyor' | 'package' | 'order'; id: string };
export type LayerKey = 'status' | 'corridors' | 'zones' | 'stations' | 'obstacles' | 'traffic' | 'grid' | 'graph' | 'access' | 'junctions' | 'closures';
export type SceneObject = SceneSelection & { label: string; center: [number,number,number]; size: [number,number,number]; floor: number; zone?: string; detail: string; aliases: string[] };
export const CAMERA_NAMES: Record<CameraMode,string> = {orbit:'Yörünge kamera',walk:'İçeride gez',top:'Üstten plan',isometric:'İzometrik görünüm',third:'Robot takibi',first:'Robotun gözünden',cinematic:'Sinematik genel bakış'};
export const LAYER_NAMES: Record<LayerKey,string> = {status:'Robot durumları',corridors:'Gezilebilir koridorlar',zones:'Depolama bölgeleri',stations:'İstasyon noktaları',obstacles:'Engel sınırları',traffic:'Rota yönleri',grid:'Metre ızgarası',graph:'Navigasyon grafı / yönler',access:'Operasyon erişim düğümleri',junctions:'Kavşak düğümleri',closures:'Canlı hücre / kenar kapatmaları'};
export function indexObjects(layout: WarehouseLayout): SceneObject[] {
  const elevation = (floor=1) => layout.floors.find(f=>f.id===floor)?.elevation ?? 0;
  const objects: SceneObject[] = layout.racks.map(r=>({kind:'rack',id:r.id,label:r.id,center:[r.position[0]+r.size[0]/2,elevation(r.floor)+r.position[1]+r.size[1]/2,r.position[2]+r.size[2]/2],size:r.size,floor:r.floor??1,zone:r.zone??undefined,detail:`${r.levels} seviye · ${r.size.join(' × ')} m`,aliases:layout.locations.filter(l=>l.rack_id===r.id).map(l=>l.id)}));
  for(const z of layout.zones){ const xs=z.polygon.map(p=>p[0]),zs=z.polygon.map(p=>p[1]); objects.push({kind:'zone',id:z.id,label:`${z.id} · ${z.name}`,center:[(Math.min(...xs)+Math.max(...xs))/2,elevation(z.floor)+.05,(Math.min(...zs)+Math.max(...zs))/2],size:[Math.max(...xs)-Math.min(...xs),.08,Math.max(...zs)-Math.min(...zs)],floor:z.floor??1,zone:z.id,detail:z.name,aliases:[z.name]}); }
  for(const s of layout.stations) objects.push({kind:'station',id:s.id,label:s.id,center:[(s.rect[0]+s.rect[2])/2,1.25,(s.rect[1]+s.rect[3])/2],size:[s.rect[2]-s.rect[0],2.5,s.rect[3]-s.rect[1]],floor:1,zone:s.zone,detail:s.kind,aliases:[]});
  for(const l of layout.locations) if(!l.rack_id && !objects.some(o=>o.id===l.id)) objects.push({kind:'location',id:l.id,label:l.id,center:[l.access_point[0],elevation(l.floor)+.15,l.access_point[1]],size:[1,.3,1],floor:l.floor??1,zone:l.zone,detail:l.kind,aliases:[]});
  for(const c of layout.conveyors){const xs=c.path.map(p=>p[0]),zs=c.path.map(p=>p[1]);objects.push({kind:'conveyor',id:c.id,label:c.id,center:[(Math.min(...xs)+Math.max(...xs))/2,.9,(Math.min(...zs)+Math.max(...zs))/2],size:[Math.max(...xs)-Math.min(...xs)+c.width,1.8,Math.max(...zs)-Math.min(...zs)+c.width],floor:1,zone:c.zone,detail:c.placement==='exterior'?'Dış çevre bant segmenti':'Konveyör segmenti',aliases:[]});}
  return objects;
}
export function searchObjects(objects: SceneObject[], twin: Pick<TwinState,'robots'>, query: string): SceneObject[] {
  const q=query.trim().toLocaleLowerCase('tr'); if(!q)return [];
  const robots: SceneObject[]=Object.values(twin.robots).map(r=>({kind:'robot',id:r.id,label:r.id,center:[...r.position],size:[1.3,2.1,1.3],floor:r.floor,zone:r.zone??undefined,detail:r.status,aliases:[]}));
  return [...robots,...objects].filter(o=>[o.id,o.label,...o.aliases].some(s=>s.toLocaleLowerCase('tr').includes(q))).sort((a,b)=>Number(b.id.toLowerCase()===q||b.aliases.some(s=>s.toLowerCase()===q))-Number(a.id.toLowerCase()===q||a.aliases.some(s=>s.toLowerCase()===q))).slice(0,12);
}
/** Perspective camera fit for all eight corners, including tall racks and narrow viewports. */
export function frameObject(center: number[], size: number[], aspect: number, mode: CameraMode, fov=42) {
  const raw=mode==='top'?[0,1,.0001]:mode==='isometric'?[1,1,1]:[.35,.85,1];
  const n=Math.hypot(...raw),d=raw.map(v=>v/n),rn=Math.hypot(d[2],d[0]);
  const right=[d[2]/rn,0,-d[0]/rn],up=[d[1]*right[2],d[2]*right[0]-d[0]*right[2],-d[1]*right[0]];
  const dot=(a:number[],b:number[])=>a.reduce((v,x,i)=>v+x*b[i],0);
  const tan=Math.tan(fov*Math.PI/360); let distance=4;
  for(const x of [-size[0]/2,size[0]/2])for(const y of [-size[1]/2,size[1]/2])for(const z of [-size[2]/2,size[2]/2]){const p=[x,y,z];distance=Math.max(distance,dot(p,d)+Math.max(Math.abs(dot(p,right))/(tan*Math.max(.2,aspect)),Math.abs(dot(p,up))/tan));}
  return center.map((v,i)=>v+d[i]*distance*1.08) as [number,number,number];
}
