import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { layout } from "../../state/store";
import type { LayoutRack } from "../../layout/types";

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const PALETTE = ["#cba678", "#d9bb91", "#bca07d", "#dbc5a2", "#b8956b"];
const BATCH_SIZE = 24;
type Instance = { matrix: THREE.Matrix4; color?: string };
export type RackBatchData = { key: string; origin: [number, number, number]; frame: Instance[]; shelves: Instance[]; pallets: Instance[]; cartons: Instance[]; distantCartons: Instance[] };

/** Deterministic per-rack stock: adding a rack does not reshuffle all existing stock. */
function randomFor(id: string) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return () => { seed = Math.imul(seed ^ seed >>> 15, 2246822507); seed = Math.imul(seed ^ seed >>> 13, 3266489909); return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
}

/** Render bounds deliberately match the axis-aligned rack volumes used by navigation. */
export function buildRackBatches(racks: readonly LayoutRack[], floor: number): RackBatchData[] {
  const batches = new Map<string, RackBatchData>();
  const transform = new THREE.Object3D();
  for (const rack of racks) {
    if ((rack.floor ?? 1) !== floor) continue;
    const [x, baseY, z] = rack.position, [width, height, depth] = rack.size;
    if (width <= 0 || height <= 0 || depth <= 0 || rack.levels < 1) continue;
    const bx = Math.floor(x / BATCH_SIZE) * BATCH_SIZE, bz = Math.floor(z / BATCH_SIZE) * BATCH_SIZE;
    const key = `${bx}:${bz}`;
    let batch = batches.get(key);
    if (!batch) { batch = { key, origin: [bx, 0, bz], frame: [], shelves: [], pallets: [], cartons: [], distantCartons: [] }; batches.set(key, batch); }
    const add = (target: Instance[], px: number, py: number, pz: number, sx: number, sy: number, sz: number, color?: string, angle = 0) => {
      transform.position.set(x - bx + px, baseY + py, z - bz + pz);
      transform.rotation.set(0, 0, angle); transform.scale.set(sx, sy, sz); transform.updateMatrix();
      target.push({ matrix: transform.matrix.clone(), color });
    };
    const post = Math.min(0.1, width * 0.06, depth * 0.06);
    const margin = post + Math.min(0.035, width * 0.015, depth * 0.015);
    for (const px of [post / 2, width - post / 2]) for (const pz of [post / 2, depth - post / 2]) add(batch.frame, px, height / 2, pz, post, height, post);
    // Rear X bracing sits strictly inside the navigation obstacle, including bar thickness.
    const braceWidth = Math.max(0.02, width - margin * 2), braceHeight = Math.max(0.02, height - margin * 2);
    const angle = Math.atan2(braceHeight, braceWidth), length = Math.hypot(braceWidth, braceHeight);
    for (const sign of [-1, 1]) add(batch.frame, width / 2, height / 2, depth - margin, length, Math.min(0.04, post / 2), post / 2, undefined, sign * angle);
    const levelHeight = height / rack.levels;
    const rnd = randomFor(rack.id);
    const innerWidth = width - margin * 2, innerDepth = depth - margin * 2;
    for (let level = 0; level < rack.levels; level++) {
      const deck = Math.min(0.065, levelHeight * 0.08), beam = Math.min(0.115, levelHeight * 0.12);
      const shelfY = level * levelHeight;
      add(batch.shelves, width / 2, shelfY + deck / 2, depth / 2, width - post, deck, depth - post);
      for (const pz of [post / 2, depth - post / 2]) add(batch.shelves, width / 2, shelfY + beam / 2, pz, width - post, beam, post);
      const palletHeight = Math.min(0.10, levelHeight * 0.12);
      const cartonBase = shelfY + Math.max(deck, beam) + palletHeight;
      const availableHeight = Math.max(0.01, levelHeight - Math.max(deck, beam) - palletHeight - Math.min(0.12, levelHeight * 0.1));
      const slots = Math.max(1, Math.min(8, Math.floor(innerWidth / 0.8)));
      const slotWidth = innerWidth / slots;
      let occupied = false;
      for (let slot = 0; slot < slots; slot++) {
        if (rnd() > 0.78) continue;
        occupied = true;
        const cartonWidth = slotWidth * (0.78 + rnd() * 0.15), cartonHeight = availableHeight * (0.55 + rnd() * 0.39);
        add(batch.cartons, margin + (slot + 0.5) * slotWidth, cartonBase + cartonHeight / 2, depth / 2, cartonWidth, cartonHeight, innerDepth * (0.74 + rnd() * 0.2), PALETTE[Math.floor(rnd() * PALETTE.length)]);
      }
      if (occupied) {
        // Three pallet runners per occupied shelf; one shared material batch for all racks.
        for (const fraction of [0.16, 0.5, 0.84]) add(batch.pallets, margin + innerWidth * fraction, cartonBase - palletHeight / 2, depth / 2, Math.min(0.16, innerWidth * 0.16), palletHeight, innerDepth, "#8e7354");
        add(batch.distantCartons, width / 2, cartonBase + availableHeight * 0.36, depth / 2, innerWidth * 0.93, availableHeight * 0.72, innerDepth * 0.86, PALETTE[level % PALETTE.length]);
      }
    }
  }
  return [...batches.values()];
}

function makeCartonTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#dfd7c5"; ctx.fillRect(57, 0, 14, 128);
  ctx.fillStyle = "#f7f5ef"; ctx.fillRect(78, 63, 38, 33);
  ctx.fillStyle = "#536169"; ctx.font = "bold 5px sans-serif"; ctx.fillText("WARETWIN", 81, 70);
  for (let i = 0; i < 15; i++) ctx.fillRect(82 + i * 2, 75, i % 3 ? 1 : 1.5, 12);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 2;
  return texture;
}

function Instances({ items, material, shadow = false, meshRef }: { items: Instance[]; material: THREE.Material; shadow?: boolean; meshRef?: React.MutableRefObject<THREE.InstancedMesh | null> }) {
  const ownRef = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const mesh = ownRef.current; if (!mesh) return;
    const color = new THREE.Color();
    items.forEach((item, index) => { mesh.setMatrixAt(index, item.matrix); if (item.color) mesh.setColorAt(index, color.set(item.color)); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    if (meshRef) meshRef.current = mesh;
    return () => { if (meshRef) meshRef.current = null; };
  }, [items, meshRef]);
  if (!items.length) return null;
  return <instancedMesh ref={ownRef} args={[UNIT_BOX, material, items.length]} castShadow={shadow} receiveShadow frustumCulled dispose={null} />;
}

function RackBatch({ data, materials, castShadow }: { data: RackBatchData; materials: THREE.Material[]; castShadow: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const near = useRef<THREE.InstancedMesh | null>(null), far = useRef<THREE.InstancedMesh | null>(null), pallets = useRef<THREE.InstancedMesh | null>(null);
  const center = useMemo(() => new THREE.Vector3(BATCH_SIZE / 2, 3, BATCH_SIZE / 2), []);
  const world = useMemo(() => new THREE.Vector3(), []);
  const distant = useRef(false);
  useFrame(({ camera }) => {
    if (!group.current) return;
    world.copy(center); group.current.localToWorld(world);
    const distance = camera.position.distanceToSquared(world);
    // Hysteresis prevents flickering around the LOD boundary. Never triggers a React render.
    if (distance > 120 * 120) distant.current = true;
    else if (distance < 105 * 105) distant.current = false;
    if (near.current) near.current.visible = !distant.current;
    if (far.current) far.current.visible = distant.current;
    if (pallets.current) pallets.current.visible = !distant.current;
  });
  return <group ref={group} position={data.origin}>
    <Instances items={data.frame} material={materials[0]} shadow={castShadow} />
    <Instances items={data.shelves} material={materials[1]} />
    <Instances items={data.pallets} material={materials[2]} meshRef={pallets} />
    <Instances items={data.cartons} material={materials[3]} shadow={castShadow} meshRef={near} />
    <Instances items={data.distantCartons} material={materials[2]} meshRef={far} />
  </group>;
}

/** Four material draws per visible near bucket; three for distant buckets, excluding shadow passes. */
export function RackInstances({ castShadow = true, floor = 1, yOffset = 0 }: { castShadow?: boolean; floor?: number; yOffset?: number }) {
  const data = useMemo(() => buildRackBatches(layout.racks, floor), [floor]);
  const materials = useMemo(() => [
    new THREE.MeshStandardMaterial({ color: "#34566c", roughness: 0.6, metalness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: "#d6a04c", roughness: 0.66, metalness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.94 }),
    new THREE.MeshStandardMaterial({ map: makeCartonTexture(), roughness: 0.95 }),
  ], []);
  useEffect(() => () => { materials.forEach(material => { material.map?.dispose(); material.dispose(); }); }, [materials]);
  return <group position-y={yOffset}>{data.map(batch => <RackBatch key={batch.key} data={batch} materials={materials} castShadow={castShadow} />)}</group>;
}
