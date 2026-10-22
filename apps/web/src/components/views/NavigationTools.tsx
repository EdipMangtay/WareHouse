import { useEffect, useState } from 'react';
import { layout, useStore } from '../../state/store';
import { API_URL } from '../../services/ws';
import type { NavigationSnapshot, NavigationValidation, P2 } from '../../layout/types';
import { cellCenter } from '../../simulation/astar';

function parseCell(text:string):P2 {
  if(!/^\s*\d+\s*,\s*\d+\s*$/.test(text))throw new Error('Hücreyi sütun,satır olarak girin (ör. 40,14).');
  const [c,r]=text.split(',').map(Number);
  if(c>=layout.grid.cols||r>=layout.grid.rows)throw new Error('Hücre depo sınırları dışında.');
  return [c,r];
}
export function NavigationTools(){
  const [open,setOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState(''),[kind,setKind]=useState<'cell'|'edge'>('cell'),[both,setBoth]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[checked,setChecked]=useState<(NavigationValidation&{tick?:number})|null>(null);
  const source=useStore(s=>s.source),af=useStore(s=>s.activeFloor),layers=useStore(s=>s.layers),snapshot=useStore(s=>s.navigation);
  const show=layers.closures;
  const floor=typeof af==='number'?af:1, graph=layout.navigation_graph, online=source==='online';
  const current=snapshot?.floor===floor?snapshot:null;
  useEffect(()=>{
    let disposed=false;const controller=new AbortController();
    useStore.getState().setNavigation(null);setChecked(null);setError('');
    async function poll(){
      try{
        const r=await fetch(`${API_URL}/api/navigation?floor=${floor}`,{signal:controller.signal});if(!r.ok)throw new Error(`Navigasyon verisi alınamadı (${r.status}).`);
        const data:NavigationSnapshot=await r.json();if(data.layout_revision!==layout.revision)throw new Error('Yerleşim sürümleri farklı. Uygulamayı yeniden başlatın.');
        if(!disposed){useStore.getState().setNavigation(data);setError('');}
      }catch(e){if(!disposed){useStore.getState().setNavigation(null);setError(e instanceof Error?e.message:'Bağlantı hatası');}}
    }
    if(online&&(open||show)){void poll();const interval=setInterval(poll,2000);return()=>{disposed=true;controller.abort();clearInterval(interval);};}
    return()=>{disposed=true;controller.abort();};
  },[floor,online,open,show]);
  async function mutate(action:'block'|'unblock'){
    setError('');setMessage('');setBusy(true);
    try{
      const a=parseCell(from),b=kind==='edge'?parseCell(to):null;
      const r=await fetch(`${API_URL}/api/navigation/disruptions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({floor,action,cells:b?[]:[a],edges:b?[[a,b]]:[],bidirectional:both})});
      const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:`İşlem reddedildi (${r.status}).`);
      setMessage(`${action==='block'?'Kapatma':'Açma'} uygulandı · rev ${data.revision}`);setChecked(null);
      if(!useStore.getState().layers.closures)useStore.getState().toggleLayer('closures');
      const next=await fetch(`${API_URL}/api/navigation?floor=${floor}`);if(!next.ok)throw new Error('Güncel durum alınamadı.');const snap:NavigationSnapshot=await next.json();
      if(snap.layout_revision!==layout.revision)throw new Error('Yerleşim sürümleri farklı.');useStore.getState().setNavigation(snap);
    }catch(e){setError(e instanceof Error?e.message:'İşlem tamamlanamadı.');}finally{setBusy(false);}
  }
  async function validate(){setBusy(true);setError('');try{const r=await fetch(`${API_URL}/api/navigation/validate`);if(!r.ok)throw new Error(`Doğrulama başarısız (${r.status}).`);setChecked(await r.json());}catch(e){setError(String(e));}finally{setBusy(false);}}
  function focus(){try{const c=parseCell(from),[x,z]=cellCenter(c,layout.grid.cell_size),s=useStore.getState();s.setActiveFloor(floor);s.setCameraMode('top');s.frame([x,(layout.floors.find(f=>f.id===floor)?.elevation??0)+.1,z],[12,2,12]);}catch(e){setError(String(e));}}
  let coordinates='';try{const [x,z]=cellCenter(parseCell(from),layout.grid.cell_size);coordinates=`Dünya merkezi: X ${x.toFixed(2)} / Z ${z.toFixed(2)} m`;}catch{}
  const report=checked??graph?.validation,info=report?.floors[String(floor)];
  return <div className="nav-tools"><button className="exp-layer-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>⌘ Navigasyon</button>
    {open&&<section className="nav-panel" aria-label="Navigasyon geliştirici araçları"><header><div><small>UZAMSAL GRAF · GELİŞTİRİCİ</small><h3>Navigasyon laboratuvarı</h3></div><button aria-label="Navigasyonu kapat" onClick={()=>setOpen(false)}>×</button></header>
      <p>{floor}. kat · {graph?.cell_size??layout.grid.cell_size} m hücre · robot yarıçapı {layout.navigation?.robot_radius??'tanımsız'} m<br/>{info?.walkable_cells.toLocaleString('tr-TR')??'—'} yürünebilir hücre · {graph?.nodes.filter(n=>n.floor===floor).length??0} erişim / başlangıç düğümü</p>
      <div className={`nav-health ${report?.valid?'ok':'warn'}`}>{report?.valid?'● Erişilebilirlik doğrulandı':'● Yerleşim uyarısı'}<small>{checked?`Canlı kontrol · tick ${checked.tick}`:'Başlangıç yerleşim doğrulaması'}</small></div>
      <div className="nav-layer-row">{(['graph','access','junctions','closures'] as const).map((key,i)=><button key={key} aria-pressed={layers[key]} onClick={()=>useStore.getState().toggleLayer(key)}>{['Graf / yön','Erişim','Kavşak','Kapatmalar'][i]}</button>)}</div>
      <p className="nav-legend">Mavi: graf · sarı: tek yön · yeşil: erişim<br/>Mor: şarj · kırmızı: geçersiz / kapalı</p>
      <button disabled={!online||busy} onClick={validate}>Canlı erişimi doğrula</button>
      {report&&!report.valid&&<div className="nav-report">{report.errors.join(' · ')}<br/>Geçersiz: {report.invalid_nodes.join(', ')||'—'}<br/>Erişilemeyen: {report.unreachable_nodes.slice(0,30).join(', ')||'—'}{report.unreachable_nodes.length>30?' …':''}<br/>Yalıtılmış bölgeler: {report.isolated_zones.join(', ')||'—'}</div>}
      <fieldset disabled={busy}><legend>Geçici navigasyon kısıtı</legend><label>Tür<select value={kind} onChange={e=>setKind(e.target.value as 'cell'|'edge')}><option value="cell">Hücre</option><option value="edge">Yönlü kenar</option></select></label><label>Hücre (sütun,satır)<input value={from} placeholder="40,14" onChange={e=>setFrom(e.target.value)}/></label>{kind==='edge'&&<><label>Komşu hücre<input value={to} placeholder="41,14" onChange={e=>setTo(e.target.value)}/></label><label className="nav-check"><input type="checkbox" checked={both} onChange={e=>setBoth(e.target.checked)}/>İki yönü birlikte değiştir</label></>}<small>{coordinates||'Koordinatlar sıfırdan başlar.'}</small><div className="nav-actions"><button disabled={!online||!current} onClick={()=>mutate('block')}>Kapat</button><button disabled={!online||!current} onClick={()=>mutate('unblock')}>Aç</button><button onClick={focus}>Odaklan</button></div></fieldset>
      <p>{online?(current?`Canlı rev ${current.revision} · tick ${current.tick} · ${current.blocked_cells.length} kapalı hücre / ${current.blocked_edges.length} yönlü kenar`:'Canlı veri bekleniyor…'):'Yerel görünüm: yalnızca başlangıç navigasyonu. Canlı kontroller backend bağlantısı gerektirir.'}</p>
      {current&&current.manual_cells.length>0&&<details><summary>Manuel kapalı hücreler ({current.manual_cells.length})</summary><p>{current.manual_cells.map(c=>c.join(',')).join(' · ')}</p></details>}
      {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="nav-error">{error}</p>}
    </section>}
  </div>;
}
