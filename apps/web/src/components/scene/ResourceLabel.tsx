import { useRef, type ReactNode } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';

/** Distance affects annotation visibility only, never the physical object. */
export function ResourceLabel({ position, selected = false, maxDistance = 100, children }: {
    position: [number, number, number]; selected?: boolean; maxDistance?: number; children: ReactNode;
}) {
    const element = useRef<HTMLDivElement>(null), point = useRef(new Vector3());
    useFrame(({ camera }) => {
        if (element.current) element.current.hidden = !selected && camera.position.distanceTo(point.current.set(...position)) > maxDistance;
    });
    return <Html position={position} center zIndexRange={[25, 10]}><div ref={element}>{children}</div></Html>;
}
