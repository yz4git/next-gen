import * as THREE from "three";
import type { WorldStyle } from "../types";

export interface WorldPalette {
  sky: number;
  fog: number;
  ground: number;
  road: number;
  roadMinor: number;
  water: number;
  park: number;
  forest: number;
  pedestrian: number;
  buildings: number[];
  roofs: number[];
  emissive: number;
  sun: number;
}

export const WORLD_PALETTES: Record<WorldStyle, WorldPalette> = {
  "low-poly": {
    sky: 0xc9e8ed,
    fog: 0xc9e8ed,
    ground: 0xd8d1bb,
    road: 0x596367,
    roadMinor: 0x7b8380,
    water: 0x5eaab2,
    park: 0x7fa16f,
    forest: 0x557b58,
    pedestrian: 0xaaa38f,
    buildings: [0xe8dfc9, 0xcdbba2, 0xb6c0bd, 0xd2a891, 0xf0e9db, 0x9faeaa],
    roofs: [0x8f6f61, 0x6f7a78, 0xa68b6a, 0x7b665f],
    emissive: 0x000000,
    sun: 0xfff2d1,
  },
  anime: {
    sky: 0x93ccff,
    fog: 0xc8e6ff,
    ground: 0xe9d9bd,
    road: 0x51586b,
    roadMinor: 0x747b8b,
    water: 0x55bde6,
    park: 0x7dd37f,
    forest: 0x44a965,
    pedestrian: 0xd6c7ad,
    buildings: [0xffead0, 0xf6b8aa, 0xb9daf4, 0xffd66d, 0xe6dcff, 0xbde0cf],
    roofs: [0xd77878, 0x677f9d, 0xb99369, 0x716b8f],
    emissive: 0x140a18,
    sun: 0xfff0c8,
  },
  cyber: {
    sky: 0x050613,
    fog: 0x090a20,
    ground: 0x090c18,
    road: 0x151b2e,
    roadMinor: 0x202943,
    water: 0x071e3f,
    park: 0x112c2a,
    forest: 0x0c2425,
    pedestrian: 0x25203e,
    buildings: [0x17213d, 0x23214d, 0x112f45, 0x2b1743, 0x182f36, 0x202b52],
    roofs: [0x4b174f, 0x103c54, 0x34225a, 0x174a47],
    emissive: 0x3a0a67,
    sun: 0x7ab8ff,
  },
  blueprint: {
    sky: 0x071d36,
    fog: 0x0c2844,
    ground: 0x0a2139,
    road: 0x1a4769,
    roadMinor: 0x245979,
    water: 0x123e67,
    park: 0x18465b,
    forest: 0x123e50,
    pedestrian: 0x1b4c69,
    buildings: [0x2d7196, 0x367ea1, 0x28688f, 0x3c88a8, 0x246083, 0x347796],
    roofs: [0x4f9cba, 0x61abc4, 0x3f87a8, 0x78b6c9],
    emissive: 0x0b3d5b,
    sun: 0x9edcff,
  },
  quality: {
    sky: 0x20232a,
    fog: 0x252a31,
    ground: 0x30343a,
    road: 0x43484e,
    roadMinor: 0x555b60,
    water: 0x315f7c,
    park: 0x44694c,
    forest: 0x31573b,
    pedestrian: 0x706d65,
    buildings: [0x4bb3fd, 0x6fd08c, 0xffc857],
    roofs: [0x4bb3fd, 0x6fd08c, 0xffc857],
    emissive: 0x000000,
    sun: 0xffffff,
  },
};

export function materialForStyle(style: WorldStyle, color: number): THREE.MeshStandardMaterial {
  const palette = WORLD_PALETTES[style];
  const cyber = style === "cyber";
  const surfaceLayer = color === palette.ground || color === palette.road || color === palette.roadMinor;
  return new THREE.MeshStandardMaterial({
    color,
    emissive: cyber || style === "blueprint" ? palette.emissive : 0x000000,
    emissiveIntensity: cyber ? 0.9 : style === "blueprint" ? 0.22 : 0,
    roughness: style === "anime" ? 0.88 : 0.72,
    metalness: cyber ? 0.2 : 0.02,
    flatShading: style !== "quality",
    side: surfaceLayer ? THREE.DoubleSide : THREE.FrontSide,
  });
}
