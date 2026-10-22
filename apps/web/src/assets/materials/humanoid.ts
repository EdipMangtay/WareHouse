import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Shared GPU resources: all fleet members use these same geometries/materials. */
export const armorGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
export const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
export const jointGeometry = new THREE.SphereGeometry(1, 10, 8);
export const ceramic = new THREE.MeshStandardMaterial({ color: "#e7edf0", roughness: 0.3, metalness: 0.35 });
export const graphite = new THREE.MeshStandardMaterial({ color: "#192c37", roughness: 0.58, metalness: 0.55 });
export const alloy = new THREE.MeshStandardMaterial({ color: "#70828e", roughness: 0.38, metalness: 0.8 });
export const rubber = new THREE.MeshStandardMaterial({ color: "#0b1720", roughness: 0.9 });
export const orange = new THREE.MeshStandardMaterial({ color: "#f79a41", roughness: 0.42, metalness: 0.25 });
export const visor = new THREE.MeshStandardMaterial({ color: "#153c4b", emissive: "#28dcec", emissiveIntensity: 1.1, roughness: 0.18, metalness: 0.6 });
export const carton = new THREE.MeshStandardMaterial({ color: "#bd9061", roughness: 0.88 });
export const tape = new THREE.MeshStandardMaterial({ color: "#e6c59a", roughness: 0.8 });
export const parcelLabel = new THREE.MeshStandardMaterial({ color: "#f4f0e5", roughness: 0.8 });

