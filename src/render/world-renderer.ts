import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ExploreMode, WorldStyle } from "../types";
import { WORLD_PALETTES } from "../generation/styles";
import { TileStreamer, type StreamingStats } from "./tile-streamer";

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
    this.sun.shadow.bias = -0.00012;
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
    if (this.currentCity) {
      this.scene.remove(this.currentCity);
      disposeObject(this.currentCity);
    }
    this.currentCity = group;
    this.scene.add(group);
    this.tileStreamer = new TileStreamer(group, radius);
    if (this.streamingListener) this.tileStreamer.onChange(this.streamingListener);
    this.orbit.maxDistance = Math.max(350, radius * 3.4);
    this.camera.far = Math.max(3_000, radius * 7);
    this.camera.updateProjectionMatrix();
  }

  frameCity(radius: number): void {
    const distance = Math.max(175, radius * 0.92);
    this.camera.position.set(distance * 0.9, distance * 0.63, distance * 0.9);
    this.orbit.target.set(0, Math.min(35, radius * 0.055), 0);
    this.orbit.update();
  }

  setStyle(style: WorldStyle, radius: number): void {
    const palette = WORLD_PALETTES[style];
    const sky = new THREE.Color(palette.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(palette.fog, 1 / Math.max(700, radius * 2.25));
    this.sun.color.setHex(palette.sun);
    this.sun.intensity = style === "cyber" ? 1.1 : 2.4;
    this.ambient.intensity = style === "cyber" ? 0.72 : 1.7;
    this.renderer.toneMappingExposure = style === "cyber" ? 1.25 : 1.05;
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
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    if (this.currentCity) disposeObject(this.currentCity);
    this.tileStreamer = null;
    this.renderer.dispose();
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

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
