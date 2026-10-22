import { useEffect, useState } from 'react';
import { layout, useStore } from '../../state/store';
import { sceneBounds } from '../../layout/sceneBounds';
import { requestWalkCapture } from '../scene/WalkController';
import { clearWalkInput, walkInput, type WalkAction } from '../scene/walking';
import './camera-console.css';

const destinations = [
  { id:'aisle', name:'Ana koridor', point:[layout.size.width/2, 14.5] as [number,number] },
  ...layout.zones.filter(z => (z.floor??1)===1 && z.id.startsWith('ZONE_')).map(z=>({
    id:z.id, name:`${z.id.replace('ZONE_','Bölge ')} · Depolama`,
    point:[z.polygon.reduce((s,p)=>s+p[0],0)/z.polygon.length,z.polygon.reduce((s,p)=>s+p[1],0)/z.polygon.length] as [number,number],
  })),
  ...layout.stations.filter(s=>s.kind==='PACKING').slice(0,1).map(s=>({id:s.id,name:'Paketleme alanı',point:s.access_point})),
  ...layout.locations.filter(l=>l.kind==='OUTBOUND').slice(0,1).map(l=>({id:l.id,name:'Sevkiyat alanı',point:l.access_point})),
];

export function resetCamera() {
  const s=useStore.getState(), site=sceneBounds(layout);
  s.setCameraMode('orbit'); s.setViewTab('3D'); s.setActiveFloor('all'); s.frame(site.center,site.size);
}

export function CameraConsole() {
  const mode=useStore(s=>s.cameraMode), settings=useStore(s=>s.cameraSettings), setSettings=useStore(s=>s.setCameraSettings);
  const captured=useStore(s=>s.walkCaptured);
  const [panel,setPanel]=useState<'settings'|'help'|null>(null);
  const walking=mode==='walk';
  return <div className="camera-console" aria-label="Kamera ve gezinme kontrolleri">
    <div className="camera-mode-strip" role="group" aria-label="Hızlı kamera modları">
      <button onClick={resetCamera} aria-pressed={mode==='orbit'} title="Genel bakışa dön"><span aria-hidden="true">◇</span> Genel</button>
      <button className="camera-walk-button" onClick={()=>useStore.getState().enterWalk()} aria-pressed={walking}><span aria-hidden="true">↟</span> İçeride gez</button>
      <button onClick={()=>{const s=useStore.getState(),site=sceneBounds(layout);s.setCameraMode('top');s.frame(site.center,site.size);}} aria-pressed={mode==='top'}><span aria-hidden="true">▦</span> Plan</button>
    </div>
    <div className="camera-secondary-row">
      <label className="wc-sr-only" htmlFor="camera-destination">Depo içinde gidilecek konum</label>
      <select id="camera-destination" value="" onChange={e=>{const destination=destinations.find(d=>d.id===e.target.value);if(destination)useStore.getState().enterWalk(destination.point);}}>
        <option value="" disabled>Konuma git…</option>
        {destinations.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button title="Kamera ayarları" aria-label="Kamera ayarları" aria-expanded={panel==='settings'} aria-controls="camera-settings" onClick={()=>setPanel(panel==='settings'?null:'settings')}>☷</button>
      <button title="Gezinme yardımı" aria-label="Gezinme yardımı" aria-expanded={panel==='help'} aria-controls="camera-help" onClick={()=>setPanel(panel==='help'?null:'help')}>?</button>
    </div>
    {walking && <div className="camera-walk-status"><i/><span>Serbest dolaşım <small>Zemin kat</small></span><button onClick={()=>captured?document.exitPointerLock():requestWalkCapture()}>{captured?'Fareyi bırak':'Fareyle bak'}</button></div>}
    {panel==='settings'&&<section id="camera-settings" className="camera-settings" aria-label="Kamera ayarları">
      <header><strong>Kamera ayarları</strong><button onClick={()=>setPanel(null)} aria-label="Kamera ayarlarını kapat">×</button></header>
      <label>Yürüme hızı <output>{settings.walkSpeed.toFixed(1)} m/sn</output><input type="range" min="1" max="8" step=".5" value={settings.walkSpeed} onChange={e=>setSettings({walkSpeed:Number(e.target.value)})}/></label>
      <label>Bakış hassasiyeti <output>{settings.sensitivity.toFixed(1)}×</output><input type="range" min=".3" max="2" step=".1" value={settings.sensitivity} onChange={e=>setSettings({sensitivity:Number(e.target.value)})}/></label>
      <label>İç kamera görüş açısı <output>{settings.fov}°</output><input type="range" min="45" max="90" step="1" value={settings.fov} onChange={e=>setSettings({fov:Number(e.target.value)})}/></label>
      <label>Sahne aydınlığı <output>{Math.round(settings.exposure*100)}%</output><input type="range" min=".7" max="1.6" step=".05" value={settings.exposure} onChange={e=>setSettings({exposure:Number(e.target.value)})}/></label>
      <button className="camera-cutaway" aria-pressed={settings.cutaway} onClick={()=>setSettings({cutaway:!settings.cutaway})}><span>Genel görünümde kesit</span><b>{settings.cutaway?'Açık':'Kapalı'}</b></button>
    </section>}
    {panel==='help'&&<section id="camera-help" className="camera-help" aria-label="Gezinme yardımı">
      <header><strong>Depoda rahatça gezin</strong><button onClick={()=>setPanel(null)} aria-label="Gezinme yardımını kapat">×</button></header>
      <dl><div><dt><kbd>W A S D</kbd> / <kbd>↑ ↓ ← →</kbd></dt><dd>İleri, geri, yana hareket</dd></div><div><dt>Sürükle / çift tıkla</dt><dd>Etrafa bak / fareyi yakala</dd></div><div><dt><kbd>Q</kbd> <kbd>E</kbd></dt><dd>Sola / sağa bak</dd></div><div><dt><kbd>Shift</kbd> / <kbd>Ctrl</kbd></dt><dd>Hızlı / hassas yürü</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Fareyi serbest bırak</dd></div></dl>
      <p>Önce sahneye dokun veya tıkla. Mini haritadan koridora geçebilir, yön tuşlarını basılı tutarak da ilerleyebilirsin.</p>
    </section>}
  </div>;
}

function HoldButton({action,label,children}: {action:WalkAction;label:string;children:React.ReactNode}) {
  const release=()=>walkInput.held.delete(action);
  return <button aria-label={label} title={label} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);walkInput.held.add(action);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();walkInput.held.add(action);}}}
    onKeyUp={release} onBlur={release}>{children}</button>;
}

export function WalkHUD() {
  const pose=useStore(s=>s.walkPose), captured=useStore(s=>s.walkCaptured);
  const site=sceneBounds(layout);
  useEffect(()=>{const clear=()=>clearWalkInput();window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);return()=>{clear();window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);};},[]);
  return <>
    <div className="walk-crosshair" aria-hidden="true">+</div>
    <div className="walk-hint">{captured?<><kbd>W A S D</kbd> hareket <span>·</span> <kbd>Esc</kbd> fareyi bırak</>:<>Bakmak için sahneyi sürükle <span>·</span> <kbd>W A S D</kbd> hareket</>}</div>
    <aside className="walk-navigator" aria-label="Dolaşım haritası ve yön tuşları">
      <header><strong><i/> KONUMUNUZ</strong><span>F1 <b>↑ K</b></span></header>
      <svg className="walk-minimap" viewBox={`${site.x0-2} ${site.z0-2} ${site.width+4} ${site.depth+4}`} role="img" aria-label="Depo mini haritası. Tıklayarak en yakın boş koridora geçin."
        onClick={e=>{const svg=e.currentTarget, matrix=svg.getScreenCTM();if(!matrix)return;const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const world=p.matrixTransform(matrix.inverse());if(world.x>=0&&world.x<=layout.size.width&&world.y>=0&&world.y<=layout.size.depth)useStore.getState().enterWalk([world.x,world.y]);}}>
        <rect x="0" y="0" width={layout.size.width} height={layout.size.depth} fill="#182c36" stroke="#48616c" strokeWidth="1"/>
        {layout.racks.filter(r=>(r.floor??1)===1).map(r=><rect key={r.id} x={r.position[0]} y={r.position[2]} width={r.size[0]} height={r.size[2]} fill="#6d7f85"/>)}
        {layout.conveyors.map(c=><polyline key={c.id} points={c.path.map(p=>p.join(',')).join(' ')} fill="none" stroke="#b99b61" strokeWidth="1.3"/>)}
        {pose&&<g transform={`translate(${pose.x} ${pose.z}) rotate(${pose.yaw*180/Math.PI})`}><path d="M 0 0 L -7 -12 Q 0 -16 7 -12 Z" fill="#88e9c1" fillOpacity=".2"/><circle r="3.2" fill="#0c1c22" stroke="#95f1ce" strokeWidth="1.2"/><path d="M 0 -2 L -1.4 1.2 L 1.4 1.2 Z" fill="#95f1ce"/></g>}
      </svg>
      <div className="walk-coordinates"><span>X {pose?.x.toFixed(1)??'—'} <small>m</small></span><span>Z {pose?.z.toFixed(1)??'—'} <small>m</small></span><span>{pose?Math.round((pose.yaw*180/Math.PI+360)%360):0}°</span></div>
      <div className="walk-pad" role="group" aria-label="Kamerayı hareket ettir">
        <HoldButton action="turnLeft" label="Sola bak">↶</HoldButton><HoldButton action="forward" label="İleri yürü">↑</HoldButton><HoldButton action="turnRight" label="Sağa bak">↷</HoldButton>
        <HoldButton action="left" label="Sola yürü">←</HoldButton><HoldButton action="back" label="Geri yürü">↓</HoldButton><HoldButton action="right" label="Sağa yürü">→</HoldButton>
      </div>
    </aside>
  </>;
}
