import { presentation, robotPose, robotElevation } from "../../simulation/presentation";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer, EffectComposerContext, Bloom, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { layout, useStore } from "../../state/store";
import { sceneBounds } from "../../layout/sceneBounds";
import { WarehouseShell } from "./WarehouseShell";
import { RackInstances } from "./RackInstances";
import { IndustrialDetails } from "./IndustrialDetails";
import { Fixtures } from "./Fixtures";
import { ZoneOverlay } from "./ZoneOverlay";
import { Robots } from "./Robots";
import { CameraGizmos } from "./Cameras";
import { People } from "./People";
import { Mezzanine, FLOOR_ELEV } from "./Mezzanine";

import { NavigationOverlay } from "./NavigationOverlay";
import { InteractionLayers } from "./InteractionLayers";
import { frameObject } from "./experience";
import { cameraObstacles, clampCameraBoom, type Point3 } from "./cameraCollision";
import { WalkController } from './WalkController';
import { useWarehouseOperations } from '../../state/warehouseOperations';
import { OperationalOverlay } from './OperationalOverlay';

const W = layout.size.width, D = layout.size.depth;
const SITE = sceneBounds(layout);
const DIAGONAL = Math.hypot(SITE.width, SITE.depth);
const INITIAL_CAMERA = { position: [W * .8, DIAGONAL * .7, D * 1.5] as [number, number, number], fov: 42, near: .08, far: DIAGONAL * 4 };
const ORBIT_TARGET: [number, number, number] = [W/2, 0, D/2];
function overview(camera: THREE.Camera) {
  const perspective = camera as THREE.PerspectiveCamera;
  const direction = new THREE.Vector3(.45, 1.1, 1).normalize();
  const right = new THREE.Vector3(1, 0, -.45).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(42 / 2));
  const tanH = tanV * (perspective.aspect || 1.6);
  let distance = 0;
  for (const x of [-SITE.width/2, SITE.width/2]) for (const z of [-SITE.depth/2, SITE.depth/2]) for (const y of [0, layout.size.height]) {
    const point = new THREE.Vector3(x, y, z);
    distance = Math.max(distance, point.dot(direction) + Math.max(Math.abs(point.dot(right))/tanH, Math.abs(point.dot(up))/tanV));
  }
  return new THREE.Vector3(W/2, 0, D/2).addScaledVector(direction, distance * 1.06);
}

/** 相機聚焦動畫：focusTarget 改變時平滑移動 OrbitControls target */
function CameraRig({ controls }: { controls: React.RefObject<OrbitControlsImpl> }) {
  const camera = useThree(s=>s.camera), viewport = useThree(s=>s.size);
  const mode = useStore(s=>s.cameraMode), target=useStore(s=>s.focusTarget), extent=useStore(s=>s.focusSize);
  const af=useStore(s=>s.activeFloor);
  const obstacles=useMemo(()=>cameraObstacles(layout,af==='exploded'),[af]);
  const goal=useRef<THREE.Vector3|null>(null), eyeGoal=useRef<THREE.Vector3|null>(null);
  const heading=useRef(0), followed=useRef<string|null>(null), reduced=useRef(false);
  const look=useMemo(()=>new THREE.Vector3(),[]), origin=useMemo(()=>new THREE.Vector3(),[]);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>{reduced.current=media.matches;};change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    if(mode==='first'||mode==='third'||mode==='walk') { goal.current=null;eyeGoal.current=null;return; }
    if(!target&&mode==='orbit'){goal.current=null;eyeGoal.current=null;return;}
    const center=target??[W/2,layout.size.height/2,D/2];
    const all=!extent&&Math.abs(center[0]-W/2)<.1&&Math.abs(center[2]-D/2)<.1;
    const size=extent??(all?SITE.size:[12,8,12]);
    goal.current=new THREE.Vector3(...center);
    if(camera instanceof THREE.OrthographicCamera){
      const fitted=frameObject(center,size,viewport.width/viewport.height,mode);
      const distance=Math.hypot(...fitted.map((v,i)=>v-center[i]));
      camera.zoom=viewport.height/(2*distance*Math.tan(42*Math.PI/360));camera.updateProjectionMatrix();
    }
    eyeGoal.current=new THREE.Vector3(...frameObject(center,size,viewport.width/viewport.height,mode));
  },[target,extent,mode,viewport.width,viewport.height,camera]);
  useFrame((_,dt)=>{
    if(mode==='walk')return;
    const state=useStore.getState(), c=controls.current;
    const robot=state.selectedRobot?state.twin.robots[state.selectedRobot]:null;
    if(c)c.autoRotate=state.cameraMode==='cinematic'&&!reduced.current&&!goal.current;
    const follow=(state.cameraMode==='first'||state.cameraMode==='third')&&robot;
    if(camera instanceof THREE.PerspectiveCamera){const fov=follow?(state.cameraMode==='first'?68:50):42;if(Math.abs(camera.fov-fov)>.01){camera.fov=THREE.MathUtils.lerp(camera.fov,fov,reduced.current?1:1-Math.exp(-8*dt));camera.updateProjectionMatrix();}}
    if(follow&&robot){
      const frame=presentation.sample(),pose=robotPose(frame,robot);
      const elevation=robotElevation(frame,pose.robot,FLOOR_ELEV,af==='exploded');
      if(followed.current!==robot.id){heading.current=pose.heading;origin.set(pose.position[0],elevation,pose.position[2]);followed.current=robot.id;look.copy(c?.target??origin);}
      const k=1-Math.exp(-5*dt);
      heading.current+=Math.atan2(Math.sin(pose.heading-heading.current),Math.cos(pose.heading-heading.current))*(1-Math.exp(-2.5*dt));
      origin.set(pose.position[0],elevation,pose.position[2]);
      const direction=new THREE.Vector3(Math.cos(heading.current),0,Math.sin(heading.current));
      const first=state.cameraMode==='first',anchor=origin.clone().add(new THREE.Vector3(0,1.5,0));
      const eye=origin.clone().addScaledVector(direction,first?.48:-4.2);eye.y+=first?1.91:3.15;
      const aim=origin.clone().addScaledVector(direction,first?7:1.3);aim.y+=first?1.91:1.35;
      if(!first)eye.fromArray(clampCameraBoom(anchor.toArray() as Point3,eye.toArray() as Point3,obstacles));
      camera.position.lerp(eye,reduced.current?1:k);look.lerp(aim,reduced.current?1:k);
      if(!first&&camera.position.distanceTo(anchor)<8)camera.position.fromArray(clampCameraBoom(anchor.toArray() as Point3,camera.position.toArray() as Point3,obstacles));
      camera.lookAt(look);c?.target.copy(look);return;
    }
    followed.current=null;
    if(!c||!goal.current||!eyeGoal.current)return;
    const k=reduced.current?1:1-Math.exp(-3.5*dt);c.target.lerp(goal.current,k);camera.position.lerp(eyeGoal.current,k);c.update();
    if(c.target.distanceTo(goal.current)<.03&&camera.position.distanceTo(eyeGoal.current)<.05){goal.current=null;eyeGoal.current=null;}
  });
  return null;
}

function Lights({ quality }: { quality: string }) {
  const shadows = quality !== "low";
  const mode=useStore(s=>s.cameraMode);
  const inside=['walk','first','third'].includes(mode);
  const key=useRef<THREE.DirectionalLight>(null!);
  const span=inside?28:Math.max(W,D)*.65;
  const sunTarget = useMemo(() => { const target = new THREE.Object3D(); target.position.set(W/2, 0, D/2); return target; }, []);
  useFrame(({camera})=>{
    if(!key.current)return;
    const x=inside?Math.round(camera.position.x/4)*4:W/2,z=inside?Math.round(camera.position.z/4)*4:D/2;
    sunTarget.position.set(x,0,z);
    key.current.position.set(x-(inside?18:W*.25),inside?38:DIAGONAL*.7,z-(inside?12:D*.2));
  });
  return (
    <>
      <ambientLight intensity={0.32} color="#eef4f8" />
      <hemisphereLight args={["#f4f8ff", "#8b9290", 1.05]} />
      <directionalLight
        ref={key} target={sunTarget} position={[W * .25, DIAGONAL * .7, D * .3]} intensity={2.15} color="#fff3df" castShadow={shadows}
        shadow-mapSize={quality === "high" ? [4096, 4096] : [2048, 2048]} shadow-bias={-.00015} shadow-normalBias={.035} shadow-radius={2}
        shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} shadow-camera-near={1} shadow-camera-far={DIAGONAL * 2}
      />
      <primitive object={sunTarget} />
      <directionalLight position={[W, 30, D]} intensity={0.8} color="#d8e8f4" />
    </>
  );
}

type RenderStats = { fps: number; calls: number; triangles: number; camera?: string };
function FpsCounter({ onStats }: { onStats: (value: RenderStats) => void }) {
  const acc = useRef({ t: 0, n: 0, calls: 0, triangles: 0 });
  const gl = useThree(s => s.gl);
  const setDpr = useThree(s=>s.setDpr);
  const budget = useRef({slow:0,fast:0});
  useEffect(() => { gl.info.autoReset = false; return () => { gl.info.autoReset = true; }; }, [gl]);
  useFrame(({ camera }, dt) => {
    acc.current.t += dt; acc.current.n++;
    acc.current.calls += gl.info.render.calls; acc.current.triangles += gl.info.render.triangles;
    gl.info.reset();
    if (acc.current.t >= 1) {
      const a = acc.current;
      // Reduce pixel cost after sustained slow frames; recover gradually. Robot
      // simulation remains fixed-tick and is never slowed by graphics quality.
      const fps=a.n/a.t, ceiling=useStore.getState().quality==='high'?1.5:useStore.getState().quality==='medium'?1.25:1;
      budget.current.slow=fps<45?budget.current.slow+1:0;
      budget.current.fast=fps>75?budget.current.fast+1:0;
      if(budget.current.slow>=2){setDpr(Math.max(.75,gl.getPixelRatio()-.15));budget.current.slow=0;}
      else if(budget.current.fast>=5){setDpr(Math.min(ceiling,window.devicePixelRatio,gl.getPixelRatio()+.1));budget.current.fast=0;}
      onStats({ fps: Math.round(a.n/a.t), calls: Math.round(a.calls/a.n), triangles: Math.round(a.triangles/a.n), camera: `Konum ${camera.position.toArray().map(n=>n.toFixed(1)).join(",")} / Bakış ${camera.getWorldDirection(new THREE.Vector3()).toArray().map(n=>n.toFixed(2)).join(",")}` });
      acc.current = { t: 0, n: 0, calls: 0, triangles: 0 };
    }
  });
  return null;
}

/** 背景、霧、以及程序化的環境貼圖 (RoomEnvironment，不需下載 HDR，離線可用) */
function Background({ env = true }: { env?: boolean }) {
  const { scene, gl } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color("#253846"); scene.fog = new THREE.Fog("#253846", DIAGONAL * 1.8, DIAGONAL * 4);
    if (!env) return;
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex; scene.environmentIntensity = 0.65;
    return () => { scene.environment = null; tex.dispose(); pmrem.dispose(); };
  }, [scene, gl, env]);
  return null;
}

export const SceneContent = memo(function SceneContent({ quality, lite = false }: { quality: "low" | "medium" | "high"; lite?: boolean }) {
  const racksVisible = useWarehouseOperations(s => s.racksVisible);
  const af = useStore((s) => s.activeFloor);
  const mode=useStore(s=>s.cameraMode),cutaway=useStore(s=>s.cameraSettings.cutaway);
  const section=!lite&&cutaway&&!['walk','first','third'].includes(mode);
  const activeFloor = lite ? "all" : af;   // CCTV / 縮圖用的 lite 場景永遠全樓層
  const f2 = layout.floors?.find((f) => f.id === 2);
  return (
    <>
      <Background env={!lite} />
      <Lights quality={lite ? "low" : quality} />
      <group visible={activeFloor === "all" || activeFloor === "exploded" || activeFloor === 1}>
        <WarehouseShell lite={lite} cutaway={section} ceiling={!lite&&['walk','first','third'].includes(mode)} />
        {(lite || racksVisible) && <RackInstances castShadow={!lite && quality !== "low"} floor={1} />}
        <Fixtures lite={lite} />
        <IndustrialDetails lite={lite} overhead={!section} />
      </group>
      {f2 && (
        <group visible={activeFloor === "all" || activeFloor === "exploded" || activeFloor === 2} position-y={activeFloor === "exploded" ? 5 : 0}>
          <Mezzanine lite={lite} />
          {(lite || racksVisible) && <RackInstances castShadow={false} floor={2} yOffset={f2.elevation} />}
        </group>
      )}
      <ZoneOverlay labels={!lite} />
      <People lite={lite} />
      <Robots lite={lite} />
      {!lite && <CameraGizmos />}
      {!lite && <OperationalOverlay/>}
    </>
  );
});

export function Scene3D() {
  const quality = useStore((s) => s.quality);
  const tool = useStore((s) => s.tool);
  const select = useStore((s) => s.select);
  const cameraMode = useStore((s) => s.cameraMode);
  const selectedRobot = useStore((s) => s.selectedRobot);
  const orbitEnabled = cameraMode!=='walk' && (!["first", "third"].includes(cameraMode) || !selectedRobot);
  const [reduced, setReduced] = useState(false);
  useEffect(()=>{const m=matchMedia("(prefers-reduced-motion: reduce)");const update=()=>setReduced(m.matches);update();m.addEventListener("change",update);return()=>m.removeEventListener("change",update);},[]);
  const controls = useRef<OrbitControlsImpl>(null!);
  const [stats, setStats] = useState<RenderStats>({ fps: 0, calls: 0, triangles: 0 });
  return (
    <>
      <Canvas
        resize={{ offsetSize: true }}
        shadows={quality !== "low" ? 'soft' : false}
        dpr={quality === "high" ? [1, 1.5] : quality === "medium" ? [1, 1.25] : 1}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
        camera={INITIAL_CAMERA}
        onCreated={({ camera,gl }) => { camera.position.copy(overview(camera)); camera.lookAt(...ORBIT_TARGET);gl.domElement.tabIndex=0;gl.domElement.setAttribute('aria-label','3D depo sahnesi. İçeride gez modunda WASD veya ok tuşlarıyla ilerleyin, sürükleyerek bakın.');const state=useStore.getState();if(state.cameraMode==='orbit'&&!state.focusTarget)state.frame(SITE.center,SITE.size); }}
        onPointerMissed={(event) => { if (cameraMode!=='walk' && tool === "select" && event.target instanceof HTMLCanvasElement) select(null); }}
      >
        {["top","isometric"].includes(cameraMode)&&<OrthographicCamera makeDefault position={INITIAL_CAMERA.position} near={.08} far={DIAGONAL*4} />}
        <SceneContent quality={quality} />
        <InteractionLayers />
        <NavigationOverlay />
        <OrbitControls ref={controls} enabled={orbitEnabled} target={ORBIT_TARGET} enableRotate={!["top","isometric"].includes(cameraMode)} autoRotate={cameraMode === "cinematic" && !reduced} autoRotateSpeed={.18} onStart={()=>{useStore.getState().focus(null);if(cameraMode==="cinematic")useStore.getState().setCameraMode("orbit");}} maxPolarAngle={cameraMode==="top" ? .001 : orbitEnabled ? Math.PI / 2.02 : Math.PI} minDistance={orbitEnabled ? .8 : 0.1} maxDistance={DIAGONAL * 2.5} enableDamping={orbitEnabled&&!reduced} dampingFactor={0.12} zoomToCursor zoomSpeed={.75} rotateSpeed={.65} panSpeed={.8} enablePan mouseButtons={tool === "pan" ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
        <CameraRig controls={controls} />
        <WalkController controls={controls}/>
        <SceneExposure/>
        <FpsCounter onStats={value => { setStats(value); useWarehouseOperations.getState().setRenderStats(value); }} />
        {quality === "high" && (
          <EffectComposer multisampling={0}>
            <IndependentDepthSources/>
            <N8AO aoRadius={.75} intensity={1.35} distanceFalloff={.6} />
            <Bloom luminanceThreshold={1.2} intensity={0.12} mipmapBlur />
            <ToneMapping/>
            <SMAA/>
          </EffectComposer>
        )}
        {quality === "medium" && (
          <EffectComposer multisampling={0}>
            <IndependentDepthSources/>
            <N8AO halfRes aoRadius={.65} intensity={1.1} distanceFalloff={.6}/>
            <ToneMapping/>
            <SMAA/>
          </EffectComposer>
        )}
      </Canvas>
      <div className={`fps${cameraMode==='walk'?' fps-walking':''}`} title={stats.camera}>{stats.fps} FPS · {quality==='high'?'YÜKSEK':quality==='medium'?'DENGELİ':'PERFORMANS'}</div>
    </>
  );
}

function SceneExposure(){
  const gl=useThree(s=>s.gl),exposure=useStore(s=>s.cameraSettings.exposure);
  useEffect(()=>{gl.toneMappingExposure=exposure;},[gl,exposure]);
  return null;
}

/** Three r169 clones DepthTexture sources by reference. Each composer's depth
 * attachment must own its source before allocation, otherwise WebGL aliases the
 * input and stable depth buffers. Keep this compatibility fix outside dependencies. */
function IndependentDepthSources() {
  const {composer}=useContext(EffectComposerContext);
  useFrame(()=>{
    const sources=new Set<THREE.Source>();
    const textures=new Set<THREE.Texture>([composer.inputBuffer.depthTexture,composer.outputBuffer.depthTexture,...composer.passes.map(pass=>pass.getDepthTexture())].filter((texture): texture is THREE.Texture=>!!texture));
    for(const texture of textures){
      if(sources.has(texture.source)){texture.source=new THREE.Source({...texture.image});texture.needsUpdate=true;}
      sources.add(texture.source);
    }
  });
  return null;
}
