import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TerrainProvider } from "../data/terrain";
import { WORLD_PALETTES } from "../generation/styles";
import {
  applyTerrainQualityColors,
  createAdaptiveTerrainGeometry,
  createTerrainLodIndex,
  orientTerrainFacesUp,
  selectTerrainLod,
  terrainResolutionMeters,
  type TerrainLodLevel,
} from "../terrain/quality";
import type { ExploreMode, LonLat, WorldStyle } from "../types";
import { TileStreamer, type StreamingStats } from "./tile-streamer";

interface TerrainLodState {
  mesh: THREE.Mesh;
  high: THREE.BufferAttribute | null;
  medium: THREE.BufferAttribute | null;
  low: THREE.BufferAttribute | null;
  radius: number;
  level: TerrainLodLevel;
}

export class WorldRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 6_000);
  readonly renderer: THREE.WebGLRenderer;
  readonly orbit: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private readonly ambient = new THREE.HemisphereLight(0xffffff, 0x52606d, 1.7);
  private currentCity: THREE.Group | null = null;
  private tileStreamer: TileStreamer | null = null;
  private exploreMode: ExploreMode = "orbit";
  private currentStyle: WorldStyle = "low-poly";
  private terrainLod: TerrainLodState | null = null;
  private terrainUpgradeGeneration = 0;
  private streamingListener?: (stats: StreamingStats) => void;
  private frame = 0;
  private fpsStartedAt = performance.now();
  private update?: (delta: number) => void;
  private fpsListener?: (fps: number) => void;
  private animationFrame = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(260, 190, 260);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.minDistance = 5;
    this.orbit.maxDistance = 2_400;
    this.orbit.target.set(0, 16, 0);

    this.sun.position.set(-260, 420, 170);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2_048, 2_048);
    this.sun.shadow.camera.left = -650;
    this.sun.shadow.camera.right = 650;
    this.sun.shadow.camera.top = 650;
    this.sun.shadow.camera.bottom = -650;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 1_300;
    this.sun.shadow.bias = -0.00005;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.ambient);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.setStyle("low-poly", 500);
    this.resize();
    this.animate();
  }

  setUpdate(update: (delta: number) => void): void {
    this.update = update;
  }

  onFps(listener: (fps: number) => void): void {
    this.fpsListener = listener;
  }

  onStreaming(listener: (stats: StreamingStats) => void): void {
    this.streamingListener = listener;
  }

  setExploreMode(mode: ExploreMode): void {
    this.exploreMode = mode;
  }

  setCity(group: THREE.Group, radius: number): void {
    const terrainGeneration = ++this.terrainUpgradeGeneration;
    if (this.currentCity) {
      this.scene.remove(this.currentCity);
      disposeObject(this.currentCity);
    }
    this.currentCity = group;
    this.scene.add(group);
    this.stabilizeSurfaceDepth(group);
    this.installTerrainLod(group, radius);
    this.tileStreamer = new TileStreamer(group, radius);
    if (this.streamingListener) this.tileStreamer.onChange(this.streamingListener);
    this.orbit.maxDistance = Math.max(350, radius * 3.4);
    this.camera.far = Math.max(3_000, radius * 7);
    this.camera.updateProjectionMatrix();

    const provider = String(group.userData["provider"] ?? "");
    const center = group.userData["center"];
    if (provider.includes("Mapzen terrain") && isLonLat(center)) {
      void this.upgradeTerrain(group, center, radius, terrainGeneration);
    }
  }

  frameCity(radius: number): void {
    const distance = Math.max(175, radius * 0.92);
    this.camera.position.set(distance * 0.9, distance * 0.63, distance * 0.9);
    this.orbit.target.set(0, Math.min(35, radius * 0.055), 0);
    this.orbit.update();
  }

  setStyle(style: WorldStyle, radius: number): void {
    this.currentStyle = style;
    const palette = WORLD_PALETTES[style];
    const sky = new THREE.Color(palette.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(palette.fog, 1 / Math.max(700, radius * 2.25));
    this.sun.color.setHex(palette.sun);
    this.sun.intensity = style === "cyber" ? 1.1 : 2.4;
    this.ambient.intensity = style === "cyber" ? 0.72 : 1.7;
    this.renderer.toneMappingExposure = style === "cyber" ? 1.25 : 1.05;
    if (style === "quality" && this.terrainLod) this.applyTerrainQualityMaterial(this.terrainLod.mesh);
  }

  getCity(): THREE.Group | null {
    return this.currentCity;
  }

  snapshot(filename = "worldseed.png"): void {
    this.renderer.render(this.scene, this.camera);
    const anchor = document.createElement("a");
    anchor.href = this.canvas.toDataURL("image/png");
    anchor.download = filename;
    anchor.click();
  }

  dispose(): void {
    this.terrainUpgradeGeneration += 1;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    if (this.currentCity) disposeObject(this.currentCity);
    this.tileStreamer = null;
    this.terrainLod = null;
    this.renderer.dispose();
  }

  private installTerrainLod(group: THREE.Group, radius: number): void {
    this.terrainLod = null;
    const terrain = group.getObjectByName("Terrain");
    if (!(terrain instanceof THREE.Mesh) || !(terrain.geometry instanceof THREE.BufferGeometry)) return;
    this.configureTerrainLod(terrain, radius);
    if (this.currentStyle === "quality") this.applyTerrainQualityMaterial(terrain);
  }

  private configureTerrainLod(mesh: THREE.Mesh, radius: number): void {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    orientTerrainFacesUp(geometry);
    configureSurfaceSide(mesh.material, THREE.DoubleSide);
    const high = geometry.getIndex();
    const medium = createTerrainLodIndex(geometry, 2);
    const low = createTerrainLodIndex(geometry, 4);
    this.terrainLod = { mesh, high, medium, low, radius, level: "high" };
    mesh.userData["terrainLod"] = "high";
    mesh.onBeforeRender = () => {
      const state = this.terrainLod;
      if (!state || state.mesh !== mesh) return;
      const index = state.level === "low" ? state.low : state.level === "medium" ? state.medium : state.high;
      geometry.setIndex(index ?? state.high);
    };
    mesh.onAfterRender = () => {
      const state = this.terrainLod;
      if (!state || state.mesh !== mesh) return;
      geometry.setIndex(state.high);
    };
  }

  private async upgradeTerrain(
    group: THREE.Group,
    center: LonLat,
    radius: number,
    generation: number,
  ): Promise<void> {
    try {
      // WorldDataService has already loaded this exact seed, so this normally
      // resolves from IndexedDB without a second network request.
      const grid = await new TerrainProvider().load(center, radius);
      if (generation !== this.terrainUpgradeGeneration || this.currentCity !== group) return;
      const terrain = group.getObjectByName("Terrain");
      if (!(terrain instanceof THREE.Mesh) || !(terrain.geometry instanceof THREE.BufferGeometry)) return;
      const previous = terrain.geometry;
      terrain.geometry = createAdaptiveTerrainGeometry(grid, radius);
      terrain.userData["terrainResolutionMeters"] = terrainResolutionMeters(grid);
      terrain.userData["terrainSourceGrid"] = `${grid.columns}×${grid.rows}`;
      previous.dispose();
      this.configureTerrainLod(terrain, radius);
      if (this.currentStyle === "quality") this.applyTerrainQualityMaterial(terrain);
    } catch {
      // Keep the already-rendered terrain if cache access or a provider retry
      // fails. Terrain Quality v2 is progressive enhancement, not a blocker.
    }
  }

  private applyTerrainQualityMaterial(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    applyTerrainQualityColors(geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material.dispose());
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    mesh.userData["terrainQualityLegend"] = "slope blue→green→amber→red; elevation changes lightness; facet density reflects active LOD";
  }

  private stabilizeSurfaceDepth(group: THREE.Group): void {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const layer = String(object.userData["worldseedLayer"] ?? "");
      const name = object.name;
      const detail = object.userData["worldseedDetail"] === true;
      if (layer === "roofs" || name.startsWith("Roofs ")) {
        configurePolygonOffset(object.material, -1, -4);
        object.renderOrder = 3;
        return;
      }
      if (layer === "roads") {
        const isRoadSurface = name.startsWith("Roads ")
          || name.startsWith("Road markings ")
          || name.startsWith("Sidewalks ");
        if (isRoadSurface && object.geometry instanceof THREE.BufferGeometry) {
          orientTerrainFacesUp(object.geometry);
        }
        configureSurfaceSide(object.material, THREE.DoubleSide);
        configurePolygonOffset(object.material, detail ? -1.25 : -0.75, detail ? -3 : -2);
        object.renderOrder = detail ? 2 : 1;
        return;
      }
      if (layer === "areas") {
        configureSurfaceSide(object.material, THREE.DoubleSide);
        configurePolygonOffset(object.material, -0.35, -1);
        object.renderOrder = 1;
      }
    });
  }

  private updateTerrainLod(): void {
    const state = this.terrainLod;
    if (!state) return;
    const cameraDistance = this.camera.position.length();
    state.level = selectTerrainLod(this.exploreMode, cameraDistance, this.camera.position.y, state.radius);
    state.mesh.userData["terrainLod"] = state.level;
  }

  private updateDepthPrecision(): void {
    const viewDistance = this.camera.position.distanceTo(this.orbit.target);
    let near = 0.08;
    if (this.exploreMode === "fly") {
      near = clamp(viewDistance * 0.001, 0.12, 0.7);
    } else if (this.exploreMode === "orbit" || this.exploreMode === "drone") {
      near = clamp(viewDistance * 0.0025, 0.2, 2.5);
    }
    if (Math.abs(this.camera.near - near) < 0.025) return;
    this.camera.near = near;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, 1.8);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.update?.(delta);
    this.tileStreamer?.update(this.camera, this.exploreMode);
    if (this.orbit.enabled) this.orbit.update();
    this.updateTerrainLod();
    this.updateDepthPrecision();
    this.renderer.render(this.scene, this.camera);

    this.frame += 1;
    const now = performance.now();
    if (now - this.fpsStartedAt > 700) {
      this.fpsListener?.(Math.round((this.frame * 1_000) / (now - this.fpsStartedAt)));
      this.frame = 0;
      this.fpsStartedAt = now;
    }
  };
}

function isLonLat(value: unknown): value is LonLat {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function configureSurfaceSide(material: THREE.Material | THREE.Material[], side: THREE.Side): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const candidate of materials) {
    if (candidate.side === side) continue;
    candidate.side = side;
    candidate.needsUpdate = true;
  }
}

function configurePolygonOffset(
  material: THREE.Material | THREE.Material[],
  factor: number,
  units: number,
): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const candidate of materials) {
    if (!(candidate instanceof THREE.MeshBasicMaterial) && !(candidate instanceof THREE.MeshStandardMaterial)) continue;
    candidate.polygonOffset = true;
    candidate.polygonOffsetFactor = factor;
    candidate.polygonOffsetUnits = units;
    candidate.needsUpdate = true;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
