import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useResearch } from '../../../state/research';
import type { Selection } from '../presentation';
import type { Point } from './layout';
import { palette } from './theme';
export const box = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshStandardMaterial>();
export function material(color: string) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .15 }));
    return materials.get(color)!;
}
export function Block({ at, size, color = palette.steel, shadow = true }: { at: Point; size: Point; color?: string; shadow?: boolean }) {
    return <mesh geometry={box} material={material(color)} dispose={null} position={at} scale={size} castShadow={shadow} receiveShadow/>;
}
export function Selectable({ target, children }: { target: Selection; children: React.ReactNode }) {
    const [hovered, hover] = useState(false);
    return <group onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); useResearch.getState().select(target); }} onPointerOver={e => { e.stopPropagation(); hover(true); }} onPointerOut={() => hover(false)}>
        {children}{hovered && <Html center position={[0, 3, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[15, 0]}><span className="wt-hover-label">{target.id} · incele</span></Html>}
    </group>;
}
export function SceneLabel({ at, children, target, active = false }: { at: Point; children: React.ReactNode; target?: Selection; active?: boolean }) {
    return <Html position={at} center zIndexRange={[20, 0]}><button className={`wt-scene-label ${active ? 'active' : ''}`} onClick={e => { e.stopPropagation(); if (target) useResearch.getState().select(target); }}>{children}</button></Html>;
}
export function FloorText({ text, at, width = 5, color = palette.steel }: { text: string; at: Point; width?: number; color?: string }) {
    const texture = useMemo(() => { const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128; const ctx = canvas.getContext('2d')!; ctx.font = '600 50px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 384, 64); const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t; }, [text, color]);
    useEffect(() => () => texture.dispose(), [texture]);
    return <mesh position={at} rotation-x={-Math.PI / 2}><planeGeometry args={[width, width / 6]}/><meshBasicMaterial map={texture} transparent depthWrite={false}/></mesh>;
}
export function FloorArrow({ at, rotation = 0, color = palette.line }: { at: Point; rotation?: number; color?: string }) {
    return <group position={at} rotation-y={rotation}><Block at={[0, 0, 0]} size={[1, .02, .1]} color={color} shadow={false}/><mesh position={[.55, 0, 0]} rotation-z={-Math.PI / 2}><coneGeometry args={[.22, .45, 3]}/><meshBasicMaterial color={color}/></mesh></group>;
}
export function InstancedBlocks({ positions, size, color }: { positions: Point[]; size: Point; color: string }) {
    const ref = useRef<THREE.InstancedMesh>(null!);
    useEffect(() => { const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const scale = new THREE.Vector3(...size); positions.forEach((p, i) => ref.current.setMatrixAt(i, m.compose(new THREE.Vector3(...p), q, scale))); ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); }, [positions, size]);
    return <instancedMesh ref={ref} args={[box, material(color), positions.length]} dispose={null} receiveShadow/>;
}
