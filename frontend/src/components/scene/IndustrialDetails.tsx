import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { layout, useStore } from "../../state/store";
import type { WarehouseLayout } from "../../layout/types";

const BOX = new THREE.BoxGeometry(1, 1, 1);
const TILE = 24;
type DetailInstance = { matrix: THREE.Matrix4; color: string };
type DetailBatch = { key: string; origin: [number, number, number]; paint: DetailInstance[]; steel: DetailInstance[]; lights: DetailInstance[] };
type SignData = { id: string; text: string; subtitle: string; color: string; position: [number, number, number]; zone: boolean };
const KIND_NAMES: Record<string, string> = { PACKING: "PAKETLEME", SORTING: "AYRIŞTIRMA", PICKING: "TOPLAMA", INBOUND: "MAL KABUL", OUTBOUND: "SEVKİYAT", LOADING: "YÜKLEME", QUALITY: "KALİTE KONTROL", MAINTENANCE: "BAKIM" };

/** Paint has no collision volume; all new structural pieces stay overhead. */
export function buildIndustrialDetails(source: WarehouseLayout, floor: number, overhead: boolean) {
  const buckets = new Map<string, DetailBatch>();
  const signs: SignData[] = [];
  const object = new THREE.Object3D();
  const add = (kind: "paint" | "steel" | "lights", p: [number, number, number], size: [number, number, number], color: string, ry = 0, rz = 0) => {
    const bx = Math.floor(p[0] / TILE) * TILE, bz = Math.floor(p[2] / TILE) * TILE, key = `${bx}:${bz}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { key, origin: [bx, 0, bz], paint: [], steel: [], lights: [] }; buckets.set(key, bucket); }
    object.position.set(p[0] - bx, p[1], p[2] - bz); object.scale.set(...size); object.rotation.set(0, ry, rz); object.updateMatrix();
    bucket[kind].push({ matrix: object.matrix.clone(), color });
  };
  const groundLine = (a: number[], b: number[], color: string, width = 0.07, dashed = false) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length < 0.05) return;
    const pieces = dashed ? Math.ceil(length / 2.5) : Math.ceil(length / 12);
    for (let i = 0; i < pieces; i++) {
      const step = length / pieces, span = dashed ? Math.min(1.15, step * 0.65) : step;
      const t = (i + 0.5) / pieces;
      add("paint", [a[0] + dx * t, 0.018, a[1] + dz * t], [span, 0.012, width], color, -Math.atan2(dz, dx));
    }
  };
  for (const zone of source.zones.filter(z => (z.floor ?? 1) === floor)) {
    if (!zone.polygon.length) continue;
    const xs = zone.polygon.map(p => p[0]), zs = zone.polygon.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    signs.push({ id: `zone-${zone.id}`, text: `${zone.id}  ${zone.name.toLocaleUpperCase("tr")}`, subtitle: "WARETWIN · OPERASYON BÖLGESİ", color: zone.color, position: [x0 + Math.min(5, (x1 - x0) / 2), 4.2, z0 + Math.min(2, (z1 - z0) / 2)], zone: true });
  }
  if (floor === 1) {
    for (const walkway of source.walkways) {
      const points = walkway.polygon;
      if (points.length < 3) continue;
      for (let i = 0; i < points.length; i++) groundLine(points[i], points[(i + 1) % points.length], walkway.robots_allowed ? "#bdc9c8" : "#e5b664", 0.085, true);
      // Floor paint follows only explicit walkways; no invented transit corridors.
      const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const longX = x1 - x0 > z1 - z0, length = longX ? x1 - x0 : z1 - z0;
      if (length > 6) for (let d = 4; d < length - 2; d += 12) {
        const cx = longX ? x0 + d : (x0 + x1) / 2, cz = longX ? (z0 + z1) / 2 : z0 + d;
        // Chevron is a flat marking, not a navigation obstacle.
        const heading = longX ? 0 : -Math.PI / 2;
        for (const side of [-1, 1]) {
          const ox = Math.cos(heading) * -0.28 + Math.sin(heading) * side * 0.22;
          const oz = -Math.sin(heading) * -0.28 + Math.cos(heading) * side * 0.22;
          add("paint", [cx + ox, 0.026, cz + oz], [0.68, 0.009, 0.09], "#c8d2ce", heading + side * Math.PI / 5);
        }
      }
    }
    for (const station of source.stations) {
      const [x0, z0, x1, z1] = station.rect;
      const color = source.zones.find(z => z.id === station.zone)?.color ?? "#6cb8bb";
      const inset = Math.min(0.15, (x1 - x0) / 8, (z1 - z0) / 8);
      const corners = [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], [x0 + inset, z1 - inset]];
      corners.forEach((corner, i) => groundLine(corner, corners[(i + 1) % corners.length], color, 0.10));
      signs.push({ id: station.id, text: station.id, subtitle: KIND_NAMES[station.kind] ?? station.kind, color, position: [(x0 + x1) / 2, 3.8, (z0 + z1) / 2], zone: false });
      // Safety hatching remains on top of the station's already blocked footprint.
      const stripeCount = Math.min(20, Math.floor((x1 - x0) / 0.7));
      for (let i = 0; i < stripeCount; i++) add("paint", [x0 + inset + 0.2 + i * ((x1 - x0 - inset * 2 - 0.4) / Math.max(1, stripeCount - 1)), 0.026, z0 + inset + 0.2], [0.12, 0.01, Math.min(0.32, (z1 - z0) / 4)], "#e6b766", -0.35);
    }
  }
  if (overhead && floor === 1) {
    const maxRackTop = source.racks.reduce((top, rack) => Math.max(top, rack.position[1] + rack.size[1] + (source.floors.find(f => f.id === (rack.floor ?? 1))?.elevation ?? 0)), 0);
    const roof = Math.max(3.5, source.size.height - 1.2, maxRackTop + 0.8);
    const { width, depth } = source.size;
    const rows = Math.max(1, Math.floor((depth - 8) / 16));
    for (let row = 0; row < rows; row++) {
      const z = 4 + (row + 0.5) * (depth - 8) / rows;
      const segments = Math.max(1, Math.ceil((width - 4) / 6)), span = (width - 4) / segments;
      for (let segment = 0; segment < segments; segment++) {
        const x = 2 + (segment + 0.5) * span;
        for (const y of [roof, roof + 0.55]) add("steel", [x, y, z], [span, 0.085, 0.12], "#596c78");
        add("steel", [x, roof + 0.275, z], [Math.hypot(span - 0.12, 0.55), 0.045, 0.06], "#78909a", 0, (segment % 2 ? -1 : 1) * Math.atan2(0.55, span - 0.12));
        if (segment % 2 === 0) {
          add("steel", [x, roof - 0.17, z], [2.3, 0.13, 0.34], "#263c49");
          add("lights", [x, roof - 0.245, z], [2.14, 0.026, 0.23], "#d9f4ff");
        }
      }
    }
  }
  return { batches: [...buckets.values()], signs };
}

function DetailInstances({ instances, material }: { instances: DetailInstance[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const color = new THREE.Color();
    instances.forEach((instance, i) => { mesh.setMatrixAt(i, instance.matrix); mesh.setColorAt(i, color.set(instance.color)); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  }, [instances]);
  if (!instances.length) return null;
  return <instancedMesh ref={ref} args={[BOX, material, instances.length]} frustumCulled dispose={null} />;
}

function IndustrialSign({ sign }: { sign: SignData }) {
  const ref = useRef<THREE.Sprite>(null!);
  const world = useMemo(() => new THREE.Vector3(), []);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#142b39"; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = sign.color; ctx.fillRect(0, 0, 8, 128); ctx.fillRect(8, 0, 504, 2);
    ctx.fillStyle = "#f2f6f8"; ctx.font = "600 29px sans-serif";
    let title = sign.text; while (ctx.measureText(title).width > 465 && title.length > 5) title = title.slice(0, -2);
    ctx.fillText(title, 24, 53);
    ctx.fillStyle = "#93aab5"; ctx.font = "17px sans-serif"; ctx.fillText(sign.subtitle, 24, 91);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; return result;
  }, [sign]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ camera }) => {
    const sprite = ref.current; if (!sprite) return;
    sprite.getWorldPosition(world);
    const distance = camera.position.distanceToSquared(world);
    // Real 3D sprites participate in depth/frustum tests. No per-label HTML or React updates.
    sprite.visible = useStore.getState().showLabels && (!sign.zone || useStore.getState().layers.zones) && distance > 9 && distance < (sign.zone ? 10000 : 2500);
    const size = Math.min(sign.zone ? 4.8 : 2.8, Math.sqrt(distance) * .18);
    sprite.scale.set(size, size / 4, 1);
  });
  return <sprite ref={ref} position={sign.position} scale={sign.zone ? [6.4, 1.6, 1] : [3.6, 0.9, 1]}>
    <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
  </sprite>;
}

/** Integrate per visible floor; yOffset uses the same floor/exploded elevation as racks. */
export function IndustrialDetails({ lite = false, floor = 1, yOffset = 0, overhead = true }: { lite?: boolean; floor?: number; yOffset?: number; overhead?: boolean }) {
  const data = useMemo(() => buildIndustrialDetails(layout, floor, overhead && !lite), [floor, overhead, lite]);
  const materials = useMemo(() => [
    new THREE.MeshBasicMaterial({ color: "#ffffff", polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.56, metalness: 0.6 }),
    new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  ], []);
  useEffect(() => () => materials.forEach(material => material.dispose()), [materials]);
  return <group position-y={yOffset}>
    {data.batches.map(batch => <group key={batch.key} position={batch.origin}>
      <DetailInstances instances={batch.paint} material={materials[0]} />
      <DetailInstances instances={batch.steel} material={materials[1]} />
      <DetailInstances instances={batch.lights} material={materials[2]} />
    </group>)}
    {!lite && data.signs.map(sign => <IndustrialSign key={sign.id} sign={sign} />)}
  </group>;
}
