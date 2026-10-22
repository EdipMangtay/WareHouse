import { ParcelDetail } from "./ConveyorPanel";
import { useMemo, useRef, useState } from 'react';
import { layout, useStore, STATUS_COLOR } from '../../state/store';
import { indexObjects, searchObjects, LAYER_NAMES, type SceneObject, type LayerKey } from '../scene/experience';
import { useWarehouseOperations } from '../../state/warehouseOperations';
const OBJECTS=indexObjects(layout);
const STATION_NAMES:Record<string,string>={PACKING:'Paketleme',SORTING:'Ayrıştırma',QUALITY:'Kalite kontrol',MAINTENANCE:'Bakım'};
const KINDS={robot:'Robot',rack:'Raf',zone:'Bölge',station:'İstasyon',location:'Konum',conveyor:'Konveyör',package:'Taşıyıcı',order:'Sipariş'};
const STATUS:Record<string,string>={ACTIVE:'Görevde',IDLE:'Hazır',CHARGING:'Şarj oluyor',WARNING:'Uyarı',ERROR:'Arızalı',OFFLINE:'Çevrimdışı',NORMAL:'Normal',CONGESTED:'Yoğun',BLOCKED:'Kapalı'};
function frame(o:SceneObject){const s=useStore.getState();const robot=o.kind==='robot'?s.twin.robots[o.id]:null;const center: [number,number,number]=robot?[robot.position[0],(layout.floors.find(f=>f.id===robot.floor)?.elevation??0)+1,robot.position[2]]:o.center;s.setViewTab('3D');s.setActiveFloor(robot?.floor??o.floor);s.setCameraMode('orbit');s.frame(center,o.kind==='robot'?[7,4,7]:o.size);}
export function ExperienceSearch(){
  const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
  const robots=useStore(s=>s.twin.robots),source=useStore(s=>s.source);
  const results=useMemo(()=>searchObjects(OBJECTS,{robots},query),[query,robots]);
  const region=useRef<HTMLDivElement>(null);
  function choose(o:SceneObject){useStore.getState().inspect({kind:o.kind,id:o.id});frame(o);setOpen(false);setQuery(o.id);}
  return <div className="exp-search" ref={region} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
    <form onSubmit={e=>{e.preventDefault();if(results[0])choose(results[0]);}}>
      <span aria-hidden="true">⌕</span><input aria-label="Robot veya konum ara" placeholder="Robot, raf veya konum ara…" value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='ArrowDown'){e.preventDefault();region.current?.querySelector<HTMLButtonElement>('.exp-results button')?.focus();}}}/>
      {query&&<button type="button" aria-label="Aramayı temizle" onClick={()=>{setQuery('');setOpen(false);}}>×</button>}
    </form>
    <span className={`exp-source ${source}`}>{source==='online'?'● CANLI MOTOR':source==='offline'?'● ÇEVRİMDIŞI':'○ BAĞLANIYOR'}</span>
    {open&&query.trim()&&<div className="exp-results" aria-label="Arama sonuçları">{results.length?results.map(o=><button key={`${o.kind}:${o.id}`} onClick={()=>choose(o)}><span>{o.label}<small>{o.aliases.join(' · ')||o.detail}</small></span><em>{KINDS[o.kind]}</em></button>):<p role="status">Bu kimlik bulunamadı.</p>}</div>}
  </div>;
}
export function ExperienceLayers(){
  const racks=useWarehouseOperations(s=>s.racksVisible),flow=useWarehouseOperations(s=>s.flowVisible),gaps=useWarehouseOperations(s=>s.gapVisible);
  const [open,setOpen]=useState(false),layers=useStore(s=>s.layers),paths=useStore(s=>s.showPaths),labels=useStore(s=>s.showLabels);
  return <div className="exp-layer-control"><button className="exp-layer-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>▱ Katmanlar</button>{open&&<section className="exp-layers" aria-label="Görselleştirme katmanları"><header>Görselleştirme<button aria-label="Katmanları kapat" onClick={()=>setOpen(false)}>×</button></header>
    <label><input type="checkbox" checked={paths} onChange={()=>useStore.getState().togglePaths()}/>Robot rotaları</label>
    <label><input type="checkbox" checked={racks} onChange={()=>useWarehouseOperations.getState().toggleRacks()}/>Rafları göster (geometri değişmez)</label>
    <label><input type="checkbox" checked={flow} onChange={()=>useWarehouseOperations.getState().toggleFlow()}/>Aktarım ve paketleme durumları</label>
    <label><input type="checkbox" checked={gaps} onChange={()=>useWarehouseOperations.getState().toggleGap()}/>Gerçek konveyör takip adımı</label>
    {(Object.entries(LAYER_NAMES) as [LayerKey,string][]).map(([key,name])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={()=>useStore.getState().toggleLayer(key)}/>{name}</label>)}
    <label><input type="checkbox" checked={labels} onChange={()=>useStore.getState().toggleLabels()}/>Endüstriyel etiketler</label>
    <p>Koridor / engel: yerleşim ızgarası.<br/>Yön okları: motorun mevcut rotaları.</p>
  </section>}</div>;
}
export function ObjectInspector(){
  const selection=useStore(s=>s.selection),twin=useStore(s=>s.twin),source=useStore(s=>s.source);
  if(!selection)return null;
  if(selection.kind==='package')return <aside className="exp-inspector" aria-label="Paket bilgileri"><header>Paket inceleyici<button aria-label="Paket seçimini kapat" onClick={()=>useStore.getState().inspect(null)}>×</button></header><ParcelDetail id={selection.id}/></aside>;
  const conveyor=selection.kind==='conveyor'?twin.conveyors[selection.id]:null;
  const robot=selection.kind==='robot'?twin.robots[selection.id]:null;
  const object=OBJECTS.find(o=>o.kind===selection.kind&&o.id===selection.id);
  const floor=robot?.floor??object?.floor??1;
  const center=robot?[robot.position[0],(layout.floors.find(f=>f.id===floor)?.elevation??0)+1,robot.position[2]] as [number,number,number]:object?.center;
  const zone=selection.kind==='zone'?twin.zones[selection.id]:null;
  const ids=new Set([selection.id,...object?.aliases??[]]);
  const tasks=Object.values(twin.tasks).filter(t=>ids.has(t.source)||ids.has(t.destination));
  const active=tasks.filter(t=>['WAITING','ASSIGNED','IN_PROGRESS'].includes(t.status));
  const currentTask=robot?.current_task_id?twin.tasks[robot.current_task_id]:null;
  const row=(label:string,value:string|number)=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>;
  return <aside className="exp-inspector" aria-label="Seçili nesne bilgileri">
    <header><span>{KINDS[selection.kind]} / {floor}. kat</span><button aria-label="Nesne seçimini kapat" onClick={()=>useStore.getState().inspect(null)}>×</button></header>
    <h2>{object?.label??selection.id}</h2><p className="exp-object-detail">{robot?.model??(object?STATION_NAMES[object.detail]??object.detail:'Bu nesne mevcut durumda bulunamadı.')}</p>
    {robot&&<><div className="exp-status" style={{color:STATUS_COLOR[robot.status]}}>{STATUS[robot.status]??robot.status}<small>{robot.fsm}</small></div><dl>{row('Batarya',`${robot.battery.toFixed(1)} %`)}{row('Hız',`${robot.velocity.toFixed(2)} m/s`)}{row('Yük',`${robot.load.current} / ${robot.load.capacity}`)}{row('Hedef',robot.destination??'—')}</dl><div className="exp-task"><span>GÜNCEL GÖREV</span><strong>{currentTask?.id??'Atanmış görev yok'}</strong>{currentTask&&<p>{currentTask.source} → {currentTask.destination}<br/>{currentTask.status}</p>}</div></>}
    {conveyor&&<dl>{row('Hız',`${conveyor.speed_mps.toFixed(2)} m/s`)}{row('Doluluk',`${conveyor.items_on_belt} / ${conveyor.capacity??'—'}`)}{row('Uzunluk',`${conveyor.length_m?.toFixed(1)??'—'} m`)}{row('Durum',conveyor.status)}</dl>}
    {zone&&<dl>{row('Durum',STATUS[zone.status]??zone.status)}{row('Robot',zone.robot_count)}{row('Yoğunluk',`${(zone.congestion*100).toFixed(0)} %`)}{zone.blocked_reason&&row('Kapanma nedeni',zone.blocked_reason)}</dl>}
    {!robot&&object&&<dl>{row('Bölge',object.zone??'—')}{selection.kind==='zone'?row('Alan',`${(object.size[0]*object.size[2]).toLocaleString('tr-TR')} m²`):row('Ölçüler',`${object.size.map(n=>n.toFixed(1)).join(' × ')} m`)}{selection.kind==='rack'&&object.aliases.length>0&&row('Erişim adresi',object.aliases.join(', '))}{selection.kind!=='zone'&&row('İlişkili aktif görev',active.length)}</dl>}
    {center&&<p className="exp-coordinates">X {center[0].toFixed(1)} · Y {center[1].toFixed(1)} · Z {center[2].toFixed(1)} m</p>}
    <div className="exp-object-actions"><button disabled={!center} onClick={()=>{if(center)frame(object??{kind:'robot',id:selection.id,label:selection.id,center,size:[7,4,7],floor,detail:'',aliases:[]});}}>Nesneye odaklan</button>{robot&&<><button onClick={()=>useStore.getState().setCameraMode('third')}>Robotu takip et</button><button onClick={()=>useStore.getState().setCameraMode('first')}>Robotun gözünden</button></>}</div>
    <footer>{source==='online'?'Canlı backend':source==='offline'?'Son snapshot':'Bağlantı bekleniyor'} · tick {twin.sim.tick}<br/>{robot||zone?'Telemetri: simülasyon motoru':'Geometri: ortak yerleşim · görevler: motor'}</footer>
  </aside>;
}
