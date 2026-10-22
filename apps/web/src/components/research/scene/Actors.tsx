import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Carrier, ResearchSnapshot, Robot } from '../../../../../../packages/contracts/research';
import type { RobotState } from '../../../schema/twin_state';
import { HumanoidRobot, type HumanoidMotion } from '../../../assets/models/HumanoidRobot';
import type { Selection } from '../presentation';
import { ROBOT_NAMES } from '../presentation';
import { carrierPosition } from './layout';
import { Block, SceneLabel, Selectable } from './primitives';
import { palette, zoneColor } from './theme';
export function RobotView({ robot, state, paused, selected, labels, reduced }: { robot: Robot; state: ResearchSnapshot; paused: boolean; selected: boolean; labels: boolean; reduced: boolean }) {
    const group = useRef<THREE.Group>(null!), initial = useRef(robot.position);
    const motion = useRef<HumanoidMotion>({ distance: 0, moving: false, paused });
    const payload = state.items.some(i => i.location === robot.id);
    useFrame((_, dt) => {
        const g = group.current; if (!g) return;
        const before = g.position.z, k = paused || reduced ? 1 : 1 - Math.exp(-Math.min(dt, .1) * 18);
        g.position.x += (robot.position[0] - g.position.x) * k;
        g.position.z += (robot.position[2] - g.position.z) * k;
        const distance = Math.abs(g.position.z - before);
        motion.current.paused = paused;
        motion.current.moving = !paused && distance > .0001 && ['MOVING_TO_PICK', 'CARRYING'].includes(robot.state);
        if (motion.current.moving) motion.current.distance += distance;
    });
    const visual: Pick<RobotState, 'status' | 'fsm' | 'load' | 'payload_package_id'> = {
        status: robot.state === 'FAILED' ? 'ERROR' : robot.state === 'CHARGING' ? 'CHARGING' : robot.state === 'IDLE' ? 'IDLE' : 'ACTIVE',
        fsm: robot.state === 'PICKING' ? 'PICKING' : robot.state === 'DROPPING' ? 'DELIVERING' : robot.state === 'IDLE' ? 'IDLE' : 'NAVIGATING',
        load: { current: payload ? 1 : 0, capacity: 1 }, payload_package_id: null,
    };
    return <group ref={group} position={initial.current}><Selectable target={{ kind: 'robot', id: robot.id }}>
        <group rotation-y={robot.state === 'MOVING_TO_PICK' || robot.state === 'PICKING' ? Math.PI / 2 : -Math.PI / 2}><HumanoidRobot r={visual} motion={motion} lite={state.robots.length > 24} simulationTimeS={state.time_s} phaseStartedS={robot.phase_started_s}/></group>
        <mesh rotation-x={-Math.PI / 2} position={[0, .065, 0]}><ringGeometry args={[selected ? .72 : .57, selected ? .85 : .65, 24]}/><meshBasicMaterial color={robot.state === 'FAILED' ? palette.error : selected ? palette.selection : palette.rail}/></mesh>
        {labels && (selected || robot.state === 'FAILED') && <SceneLabel at={[0, 2.9, 0]} target={{ kind: 'robot', id: robot.id }} active={selected}><b>{robot.id}</b><span>{ROBOT_NAMES[robot.state]}</span></SceneLabel>}
    </Selectable></group>;
}
export function CarrierView({ carrier, state, selected, labels, gaps, paused, reduced }: { carrier: Carrier; state: ResearchSnapshot; selected: boolean; labels: boolean; gaps: boolean; paused: boolean; reduced: boolean }) {
    const group = useRef<THREE.Group>(null!), previous = useRef(carrier.state), target = carrierPosition(carrier, state), initial = useRef(target);
    useFrame((_, dt) => {
        const g = group.current; if (!g) return;
        // Only smooth observed belt movement. Resource transitions have no invented travel path.
        const k = paused || reduced || previous.current !== carrier.state || carrier.state !== 'ON_BELT' ? 1 : 1 - Math.exp(-Math.min(dt, .1) * 20);
        for (let i = 0; i < 3; i++) g.position.setComponent(i, g.position.getComponent(i) + (target[i] - g.position.getComponent(i)) * k);
        previous.current = carrier.state;
    });
    const color = zoneColor(state.config.zones.findIndex(z => z.id === carrier.zone_id));
    return <group ref={group} position={initial.current}><Selectable target={{ kind: 'carrier', id: carrier.id }}>
        <Block at={[0, 0, 0]} size={[state.config.carrier_length_m, .43, .65]} color={selected ? palette.selection : color}/>
        <Block at={[0, .23, 0]} size={[state.config.carrier_length_m * .76, .035, .45]} color={palette.dark} shadow={false}/>
        <Block at={[0, .27, 0]} size={[state.config.carrier_length_m * .55, .16, .33]} color={palette.carton}/>
        <Block at={[0, .03, .33]} size={[.26, .14, .018]} color={palette.label} shadow={false}/>
        {selected && <mesh><boxGeometry args={[state.config.carrier_length_m + .16, .65, .8]}/><meshBasicMaterial color={palette.selection} wireframe/></mesh>}
        {gaps && carrier.state === 'ON_BELT' && <mesh position={[0, -.32, 0]}><boxGeometry args={[state.config.carrier_length_m + state.config.safe_gap_m, .025, 1.45]}/><meshBasicMaterial color={palette.good} wireframe/></mesh>}
        {labels && selected && <SceneLabel at={[0, 1.2, 0]} target={{ kind: 'carrier', id: carrier.id }} active><b>{carrier.order_id}</b><span>{carrier.zone_id} · taşıyıcı</span></SceneLabel>}
    </Selectable></group>;
}
export function Actors({ state, selection, orderId, paused, labels, gaps, reduced }: { state: ResearchSnapshot; selection: Selection | null; orderId: string | null; paused: boolean; labels: boolean; gaps: boolean; reduced: boolean }) {
    return <>{state.robots.map(r => <RobotView key={r.id} robot={r} state={state} paused={paused} selected={selection?.kind === 'robot' && selection.id === r.id || !!orderId && state.tasks.some(t => t.id === r.task_id && t.order_id === orderId)} labels={labels} reduced={reduced}/>)}
        {state.carriers.filter(c => c.state !== 'CONSUMED').map(c => <CarrierView key={c.id} carrier={c} state={state} selected={selection?.kind === 'carrier' && selection.id === c.id || c.order_id === orderId} labels={labels} gaps={gaps} paused={paused} reduced={reduced}/>)}
        {orderId && state.items.filter(i => i.order_id === orderId && i.location === 'SHELF').map((item, i) => { const z = state.config.zones.find(z => z.id === item.zone_id)!; return <group key={item.id} position={[z.entry_m + i % Math.max(1, z.robots) * 1.5, 0, -3 - z.pick_distance_m]}><mesh position={[0, .05, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[.35, .44, 24]}/><meshBasicMaterial color={palette.selection}/></mesh>{labels && <SceneLabel at={[0, 1, 0]} target={{ kind: 'zone', id: z.id }} active><b>{item.id}</b><span>Rafta · bekliyor</span></SceneLabel>}</group>; })}
    </>;
}
