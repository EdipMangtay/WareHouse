/** Procedural research-zone rack. Rendering asset, with no operational state. */
export function ResearchRack({ x, z, width = 5 }: {
    x: number;
    z: number;
    width?: number;
}) {
    return <group position={[x, 0, z]}>
    {[-width / 2, width / 2].map(a => <group key={a}>{[-.65, .65].map(b => <mesh key={b} position={[a, 2.2, b]} castShadow><boxGeometry args={[.12, 4.4, .12]}/><meshStandardMaterial color="#344c5d" metalness={.55} roughness={.5}/></mesh>)}</group>)}
    {[.3, 1.65, 3, 4.35].map((y, i) => <group key={y}><mesh position={[0, y, 0]} receiveShadow><boxGeometry args={[width, .13, 1.5]}/><meshStandardMaterial color="#df9253" metalness={.2} roughness={.7}/></mesh>{i < 3 && [-1.5, 0, 1.5].map((a, j) => <mesh key={a} position={[a, y + .43, 0]} castShadow><boxGeometry args={[.85, .7, .95]}/><meshStandardMaterial color={['#b48d62', '#c9aa7c', '#a89272'][j]} roughness={.95}/></mesh>)}</group>)}
  </group>;
}
