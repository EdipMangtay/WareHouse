import { ConveyorPanel } from "./components/views/ConveyorPanel";
import { useEffect, useRef, useState } from "react";
import { layout, useStore, tickToClock } from "./state/store";
import { simControl, useSimulationRunner } from "./simulation/runner";
import { Viewport } from "./components/views/Viewport";
import { ScenariosDrawer } from "./components/ops/ScenariosDrawer";
import { OpsDrawer } from "./components/ops/OpsDrawer";
import { Modals } from "./components/ops/Modals";
import { WhatIfDrawer } from "./components/ops/WhatIfDrawer";
import "./warehouse-console.css";
import { CAMERA_NAMES } from "./components/scene/experience";

const ROBOT_STATUS: Record<string, string> = {
  ACTIVE: "Görevde", IDLE: "Hazır", CHARGING: "Şarj oluyor", WARNING: "Uyarı", ERROR: "Arızalı", OFFLINE: "Çevrimdışı",
};
const TASK_STATUS: Record<string, string> = {
  WAITING: "Sırada", ASSIGNED: "Atandı", IN_PROGRESS: "İşleniyor", COMPLETED: "Tamamlandı", FAILED: "Başarısız", CANCELLED: "İptal", TRANSFERRED: "Aktarıldı",
};
const FSM: Record<string, string> = {
  IDLE: "Yeni görev bekliyor", TASK_ASSIGNED: "Görev atandı", NAVIGATING: "Ürüne ilerliyor", PICKING: "Ürünü raftan alıyor",
  TRANSPORTING: "Ürünü taşıyor", DELIVERING: "Ürünü istasyona bırakıyor", COMPLETED: "Görev tamamlandı", OBSTACLE_DETECTED: "Engel algılandı",
  REPLANNING: "Yeni rota hesaplanıyor", LOW_BATTERY: "Düşük batarya", TASK_TRANSFER: "Görev başka robota aktarılıyor", GOING_TO_CHARGE: "Şarj istasyonuna ilerliyor", CHARGING: "Batarya dolduruluyor", OFFLINE: "Bağlantı yok", ERROR: "Arıza müdahalesi gerekiyor",
};
const EVENT_NAMES: Record<string, string> = {
  TASK_CREATED: "Yeni depo görevi", TASK_ASSIGNED: "Robot görevlendirildi", TASK_STARTED: "Görev başladı", TASK_COMPLETED: "Görev tamamlandı",
  TASK_TRANSFERRED: "Görev aktarıldı", TASK_FAILED: "Görev başarısız", ROBOT_STATE_CHANGED: "Robot durumu değişti", ROUTE_PLANNED: "Rota hesaplandı",
  ROUTE_REPLANNED: "Alternatif rota seçildi", ROBOT_BATTERY_LOW: "Düşük batarya", ROBOT_OFFLINE: "Robot çevrimdışı", ROBOT_ONLINE: "Robot bağlandı",
  OBSTACLE_DETECTED: "Engel algılandı", ZONE_BLOCKED: "Bölge kapatıldı", ZONE_UNBLOCKED: "Bölge tekrar açıldı", LIFT_REQUESTED: "Asansör çağrıldı",
  LIFT_FAULT: "Asansör arızası", SCENARIO_INJECTED: "Senaryo uygulandı", SIM_STARTED: "Simülasyon başladı", SIM_PAUSED: "Simülasyon duraklatıldı",
};
const format = (value: number, digits = 0) => value.toLocaleString("tr-TR", { maximumFractionDigits: digits });

function CubeIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 3 12 7v13l-12 7L4 23V10L16 3Z" stroke="currentColor" strokeWidth="1.6"/><path d="m4 10 12 7 12-7M16 17v13M10 6.5l12 7V20" stroke="currentColor" strokeWidth="1.6"/></svg>;
}
function Notice() {
  const notice = useStore(s => s.notice);
  const setNotice = useStore(s => s.setNotice);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), Math.max(0, notice.until - Date.now())); return () => clearTimeout(timer); }, [notice, setNotice]);
  return notice ? <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span><button aria-label="Bildirimi kapat" onClick={() => setNotice(null)}>×</button></div> : null;
}

export default function WarehouseApp() {
  useSimulationRunner();
  const twin = useStore(s => s.twin);
  const selectedRobot = useStore(s => s.selectedRobot);
  const selectedLift = useStore(s => s.selectedLift);
  const select = useStore(s => s.select);
  const cameraMode = useStore(s => s.cameraMode);
  const setCameraMode = useStore(s => s.setCameraMode);
  const setViewTab = useStore(s => s.setViewTab);
  const focus = useStore(s => s.focus);
  const setActiveFloor = useStore(s => s.setActiveFloor);
  const source = useStore(s => s.source);
  const paused = useStore(s => s.paused);
  const speed = useStore(s => s.speed);
  const drawer = useStore(s => s.drawer);
  const setDrawer = useStore(s => s.setDrawer);
  const setModal = useStore(s => s.setModal);
  const quality = useStore(s => s.quality);
  const setQuality = useStore(s => s.setQuality);
  const [taskOpen, setTaskOpen] = useState(false);
  const [sceneExpanded, setSceneExpanded] = useState(true);
  const selectionInitialized = useRef(false);
  const [taskFilter, setTaskFilter] = useState("active");
  const robots = Object.values(twin.robots);
  const tasks = Object.values(twin.tasks);
  const robot = selectedRobot ? twin.robots[selectedRobot] : null;
  const lift = selectedLift ? twin.lifts[selectedLift] : null;
  const currentTask = robot?.current_task_id ? twin.tasks[robot.current_task_id] : null;
  const activeRobots = robots.filter(r => r.current_task_id && !["ERROR", "OFFLINE"].includes(r.status));
  const waiting = tasks.filter(t => t.status === "WAITING").length;
  const activeTasks = tasks.filter(t => ["ASSIGNED", "IN_PROGRESS"].includes(t.status));
  const unavailable = robots.filter(r => ["ERROR", "OFFLINE"].includes(r.status));
  const alerts = Object.values(twin.alerts).filter(a => !a.acknowledged);
  const visibleTasks = tasks.filter(t => taskFilter === "all" || (taskFilter === "waiting" ? t.status === "WAITING" : ["ASSIGNED", "IN_PROGRESS"].includes(t.status))).sort((a, b) => b.created_tick - a.created_tick).slice(0, 40);
  const latestEvents = twin.recent_events.filter(event => event.type !== "ROBOT_STATE_CHANGED").slice(0, 5);
  const ready = robots.length > 0;

  useEffect(() => {
    if (selectionInitialized.current || !robots.length) return;
    selectionInitialized.current = true;
    if (!selectedRobot && !selectedLift) {
      setActiveFloor("all"); setCameraMode("orbit");
      focus([layout.size.width / 2, 0, layout.size.depth / 2]);
    }
  }, [selectedRobot, selectedLift, ready, select, setActiveFloor, setCameraMode]);

  function followRobot(id: string, mode: "first" | "third" = "third") {
    const target = twin.robots[id];
    if (!target) return;
    select(id); setViewTab("3D"); setActiveFloor("all"); setCameraMode(mode);
  }

  function focusRobot() {
    if (!robot) return;
    setViewTab("3D"); setActiveFloor(robot.floor); setCameraMode("orbit");
    focus([robot.position[0], robot.floor === 2 ? 8 : 0, robot.position[2]]);
  }

  return <div className={`warehouse-console ${sceneExpanded ? "wc-scene-expanded" : ""}`}>
    <header className="wc-header">
      <a href="#admin" className="wc-brand" aria-label="WareTwin operasyon merkezine dön"><span className="wc-logo"><CubeIcon /></span><span><strong>Ware<span>Twin</span></strong><small>DEPO DİJİTAL İKİZİ</small></span></a>
      <nav className="wc-header-nav" aria-label="Uygulama bölümleri"><a href="#shop">Mağaza</a><a href="#admin">Operasyon merkezi</a><span aria-current="page">Canlı depo</span></nav>
      <div className="wc-header-actions"><span className={`wc-connection ${source}`} title={source === "online" ? "Siparişlerle aynı backend simülasyonuna bağlı" : source === "local" ? "Backend bağlantısı yok; tarayıcıda bağımsız demo çalışıyor" : "Backend bağlantısı kuruluyor"}><i />{source === "online" ? "BACKEND BAĞLI" : source === "local" ? "YEREL DEMO" : "BAĞLANIYOR"}</span><button className="wc-alert-button" title="Olay ve uyarı kayıtlarını aç" aria-label={`${alerts.length} etkin uyarı. Olay kayıtlarını aç`} onClick={() => setModal("audit")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9 21h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>{alerts.length > 0 && <b>{alerts.length}</b>}</button></div>
    </header>

    <section className="wc-commandbar" aria-label="Simülasyon yönetimi"><div className="wc-title"><span className="wc-kicker">CANLI OPERASYON</span><h1>Depo kontrol odası<span className={`wc-run-state ${paused ? 'paused' : ''}`}><i />{paused ? "Duraklatıldı" : "Çalışıyor"}</span></h1></div><div className="wc-command-actions"><div className="wc-clock"><span>Simülasyon saati</span><strong>{tickToClock(twin.sim.tick, twin.sim.tick_ms, true)}</strong></div><div className="wc-playback"><button className="wc-play" onClick={() => paused ? simControl.play() : simControl.pause()} aria-label={paused ? "Simülasyonu devam ettir" : "Simülasyonu duraklat"}><span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>{paused ? "Devam et" : "Duraklat"}</button><select aria-label="Simülasyon hızı" value={speed || 1} onChange={e => simControl.play(Number(e.target.value) as 1 | 2 | 5 | 10)}>{[1, 2, 5, 10].map(value => <option key={value} value={value}>{value}×</option>)}</select></div><button className={`wc-action ${drawer === "scenarios" ? "active" : ""}`} onClick={() => setDrawer("scenarios")}>ϟ <span>Senaryolar</span></button><button className={`wc-action ${drawer === "whatif" ? "active" : ""}`} onClick={() => setDrawer("whatif")}><span>Karşılaştır</span> ↗</button><button className={`wc-action wc-ai ${drawer === "ops" ? "active" : ""}`} onClick={() => setDrawer("ops")}><span aria-hidden="true">✧</span> Operasyon asistanı</button></div></section>

    {source === "local" && <div className="wc-offline-note" role="status"><span>Bağımsız yerel demo</span> Backend bağlantısı kurulamadı. Konveyör ve sipariş akışı bağlantı kurulana kadar bekletilir.</div>}

    <section className="wc-kpis" aria-label="Canlı depo göstergeleri"><div><span>Görevdeki robot</span><strong>{activeRobots.length}<small> / {robots.length}</small></strong><em>{unavailable.length ? `${unavailable.length} robot kullanılamıyor` : "Filo erişilebilir"}</em></div><div><span>İşlenen görev</span><strong>{activeTasks.length}</strong><em>{waiting} görev sırada</em></div><div><span>Tamamlanan görev</span><strong>{format(twin.kpi.operation.completed_today)}</strong><em>Bu simülasyon oturumunda</em></div><div><span>İş hacmi</span><strong>{format(twin.kpi.operation.throughput_per_min, 1)}<small> görev/dk</small></strong><em>Simülasyon zamanına göre</em></div><div><span>Filo kullanım oranı</span><strong>{format(twin.kpi.operation.avg_utilization * 100, 1)}<small>%</small></strong><em>Ortalama robot meşguliyeti</em></div></section>

    <div className="wc-workspace"><main className="wc-main"><div className="wc-stage"><Viewport expanded={sceneExpanded} onExpandedChange={setSceneExpanded} /><div className="wc-scene-caption"><span><i />{CAMERA_NAMES[cameraMode].toLocaleUpperCase("tr")}</span><span>{["first","third"].includes(cameraMode) && robot ? `${robot.id} · ${robot.floor}. kat` : ["top","isometric"].includes(cameraMode) ? "Sağ sürükle: kaydır · Tekerlek: yakınlaştır" : "Sürükle: döndür · Tekerlek: yakınlaştır"}</span></div></div>
      <section className={`wc-task-panel ${taskOpen ? 'expanded' : ''}`}><button className="wc-task-toggle" aria-expanded={taskOpen} aria-controls="wc-task-content" onClick={() => setTaskOpen(value => !value)}><span><span aria-hidden="true">▤</span> Depo görev akışı <b>{activeTasks.length + waiting}</b></span><span>{taskOpen ? "Daralt −" : "Görevleri göster +"}</span></button>{taskOpen && <div id="wc-task-content"><div className="wc-task-filter" role="group" aria-label="Görev durumu filtresi">{[["active", "İşlenen"], ["waiting", "Bekleyen"], ["all", "Tüm görevler"]].map(([value, label]) => <button key={value} className={taskFilter === value ? "active" : ""} aria-pressed={taskFilter === value} onClick={() => setTaskFilter(value)}>{label}</button>)}<button className="wc-open-all" onClick={() => setModal("tasks")}>Tüm kayıtlar ↗</button></div><div className="wc-task-table"><table><thead><tr><th>Görev</th><th>Durum</th><th>Robot</th><th>Başlangıç → Hedef</th><th>Öncelik</th></tr></thead><tbody>{visibleTasks.map(task => <tr key={task.id}><td>{task.id}</td><td><span className={`wc-task-status ${task.status.toLowerCase()}`}>{TASK_STATUS[task.status]}</span></td><td>{task.assigned_robot ? <button onClick={() => followRobot(task.assigned_robot!)}>{task.assigned_robot} ↗</button> : "Atama bekliyor"}</td><td>{task.source} <span>→</span> {task.destination}</td><td>{{ LOW: "Düşük", NORMAL: "Normal", HIGH: "Yüksek", CRITICAL: "Kritik" }[task.priority]}</td></tr>)}</tbody></table>{!visibleTasks.length && <p className="wc-empty">Bu filtrede görev bulunmuyor.</p>}</div></div>}</section>
      <ConveyorPanel />
    </main>

    <aside className="wc-inspector" aria-label="Canlı robot ve filo bilgisi"><section className="wc-inspector-section"><div className="wc-section-label"><span>ROBOT İNCELEYİCİ</span><span className="wc-live-pill"><i />CANLI</span></div><label className="wc-sr-only" htmlFor="wc-robot-select">İncelenecek robot</label><select id="wc-robot-select" className="wc-robot-select" value={selectedRobot ?? ""} onChange={e => { select(e.target.value); if (cameraMode === "first" || cameraMode === "third") followRobot(e.target.value, cameraMode); }}><option value="" disabled>Robot seçin</option>{robots.map(item => <option key={item.id} value={item.id}>{item.id} · {ROBOT_STATUS[item.status]}</option>)}</select>
      {robot ? <><div className="wc-robot-heading"><div className="wc-robot-avatar"><svg viewBox="0 0 56 64" fill="none" aria-hidden="true"><rect x="19" y="4" width="18" height="13" rx="5"/><path d="M23 10h10"/><rect x="17" y="21" width="22" height="23" rx="6"/><path d="M12 24 7 40m37-16 5 16M23 47l-3 13m13-13 3 13"/><circle cx="28" cy="30" r="3"/></svg></div><div><strong>{robot.id}</strong><span>{robot.model}</span><b className={`wc-robot-status ${robot.status.toLowerCase()}`}><i />{ROBOT_STATUS[robot.status]}</b></div></div><div className="wc-robot-activity"><span>ŞU ANDAKİ İŞLEM</span><strong>{FSM[robot.fsm] ?? robot.fsm}</strong>{robot.destination && <small>Hedef: {robot.destination}</small>}</div><div className="wc-meter-label"><span>Batarya</span><b>%{format(robot.battery)}</b></div><div className="wc-meter" role="meter" aria-label="Seçili robot bataryası" aria-valuenow={Math.round(robot.battery)} aria-valuemin={0} aria-valuemax={100}><i className={robot.battery < 20 ? "low" : ""} style={{ width: `${Math.max(0, Math.min(100, robot.battery))}%` }} /></div><dl className="wc-telemetry"><div><dt>Anlık hız</dt><dd>{format(robot.velocity, 2)} <small>m/sn</small></dd></div><div><dt>Sağlık</dt><dd>%{format(robot.health)}</dd></div><div><dt>Konum</dt><dd>{robot.floor}. kat · {robot.zone ?? "Geçiş"}</dd></div><div><dt>Tamamlanan</dt><dd>{robot.stats.tasks_completed} <small>görev</small></dd></div></dl><div className="wc-camera-actions"><button onClick={() => followRobot(robot.id)} className={cameraMode === "third" ? "active" : ""}>◎ Robotu takip et</button><button onClick={focusRobot} aria-label="Seçili robota serbest kamerada odaklan" title="Serbest kamerada robota odaklan">⌖</button></div><button className="wc-first-person" onClick={() => followRobot(robot.id, "first")}>Robotun gözünden izle <span>↗</span></button>{currentTask && <div className="wc-current-task"><div><span>ATANAN GÖREV</span><b>{currentTask.id}</b></div><p>{currentTask.source}<span>↓</span>{currentTask.destination}</p><span>{TASK_STATUS[currentTask.status]}{robot.eta_s != null ? ` · Tahmini ${format(robot.eta_s)} sn` : ""}</span></div>}</> : lift ? <div className="wc-lift-info"><h2>{lift.id}</h2><p>{lift.fault ? "Asansör arızalı" : "Asansör etkin"}</p><dl className="wc-telemetry"><div><dt>Mevcut kat</dt><dd>{lift.floor ?? "Hareket halinde"}</dd></div><div><dt>Hedef kat</dt><dd>{lift.target_floor ?? "—"}</dd></div><div><dt>İçerideki robot</dt><dd>{lift.occupant ?? "Boş"}</dd></div><div><dt>Yapılan sefer</dt><dd>{lift.trips}</dd></div></dl></div> : <p className="wc-empty">Robot bilgileri yükleniyor…</p>}
    </section>

    <section className="wc-inspector-section wc-fleet-section"><div className="wc-section-label"><span>FİLOYA HIZLI BAKIŞ</span><button onClick={() => setModal("fleet")}>Tümü ↗</button></div><div className="wc-fleet-grid">{robots.map(item => <button key={item.id} className={`${item.status.toLowerCase()} ${selectedRobot === item.id ? "selected" : ""}`} onClick={() => { select(item.id); if (cameraMode === "first" || cameraMode === "third") followRobot(item.id, cameraMode); }} title={`${item.id} · ${ROBOT_STATUS[item.status]} · Batarya %${Math.round(item.battery)}`} aria-label={`${item.id}, ${ROBOT_STATUS[item.status]}`} aria-pressed={selectedRobot === item.id}><i />{item.id}</button>)}</div><div className="wc-fleet-legend"><span><i />Görevde</span><span><i />Hazır</span><span><i />Arıza</span></div></section>

    <section className="wc-inspector-section wc-events"><div className="wc-section-label"><span>SON HAREKETLER</span><button onClick={() => setModal("audit")}>Kayıtlar ↗</button></div>{latestEvents.length ? <ol>{latestEvents.map(event => <li key={event.id}><i className={event.severity === "HIGH" || event.severity === "CRITICAL" ? "warning" : ""} /><div><strong>{EVENT_NAMES[event.type] ?? event.type.toLowerCase().replace(/_/g, " ")}</strong><span>{event.robot_id ?? event.task_id ?? event.zone_id ?? "Depo sistemi"}</span></div><time>{tickToClock(event.tick, twin.sim.tick_ms, true)}</time></li>)}</ol> : <p className="wc-empty">İlk hareket bekleniyor.</p>}</section>
    <div className="wc-quality"><label htmlFor="wc-quality">Görüntü kalitesi</label><select id="wc-quality" value={quality} onChange={e => setQuality(e.target.value as "low" | "medium" | "high")}><option value="low">Performans</option><option value="medium">Dengeli</option><option value="high">Yüksek</option></select></div>
    </aside></div>
    <footer className="wc-footer"><span><i />{source === "online" ? "Sipariş ve depo verileri senkronize" : "Yerel simülasyon verisi"}</span><span>Gerçek zamanlı dijital ikiz <b>·</b> A* rota planlama</span></footer>
    <ScenariosDrawer /><OpsDrawer /><WhatIfDrawer /><Modals /><Notice />
  </div>;
}
