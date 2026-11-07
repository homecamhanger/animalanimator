/**
 * KittenViewer — owns the WebGL scene, the render loop, and every export
 * path (still PNG, weight × pose contact sheet, turntable WebM).
 *
 * The kitten is rebuilt from scratch whenever weight/pose/coat/species
 * changes; geometries from the previous version are disposed, materials and
 * textures are cached so rebuilds stay cheap enough for live slider drags.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { POSE_ORDER, POSE_PARAMS, type PoseId } from '../animal/profiles';
import type { KittenBuild, KittenMetrics, KittenInternals } from '../animal/kitten';
import { buildSkeletonGroup, type SkeletonMode } from './skeletonScene';
import { computeSkinWeights, paintBoneWeightColors } from '../animal/skinWeights';
import type { AnimalSpec } from '../animal/registry';
import type { LegTuning } from '../animal/tuning';
import { backdropById, paintBackdrop, type BackdropId } from './backdrop';
import { composeContactSheet, type SheetCell } from './contactSheet';

export type ViewPreset = 'three-quarter' | 'front' | 'side' | 'top';
export type { BackdropId };

const SHEET_COLUMNS = [
  { weight: 0.72, name: 'Skinny' },
  { weight: 0.88, name: 'Slim' },
  { weight: 1.05, name: 'Average' },
  { weight: 1.3, name: 'Chunky' },
  { weight: 1.58, name: 'Chonk' },
];

const VIEW_PRESETS: Record<ViewPreset, { position: [number, number, number]; target: [number, number, number] }> = {
  'three-quarter': { position: [1.58, 1.14, 2.34], target: [0, 0.43, 0] },
  front: { position: [0, 0.92, 3.02], target: [0, 0.47, 0] },
  side: { position: [3.02, 0.9, 0.32], target: [0, 0.42, 0] },
  top: { position: [0.001, 4.5, 0.55], target: [0, 0, 0] },
};

const smoothstep = (t: number) => t * t * (3 - 2 * t);

export class KittenViewer {
  onMetrics: (metrics: KittenMetrics) => void = () => undefined;
  onAutoRotateChange: (enabled: boolean) => void = () => undefined;

  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly envTexture: THREE.Texture;
  private readonly floorDisc: THREE.Mesh;
  private readonly clock = new THREE.Clock();

  private spec: AnimalSpec;
  private weight = 1;
  private pose: string = 'standing';
  private coat: string = 'orangeTabby';
  private backdrop: BackdropId = 'studio';
  private tuning: Partial<LegTuning> | null = null;

  private current: KittenBuild | null = null;
  private internals: KittenInternals | null = null;
  private skeletonGroup: THREE.Group | null = null;
  private skeletonMode: SkeletonMode = 'off';
  private furFade: { transparent: boolean; opacity: number; depthWrite: boolean } | null = null;
  private weightsMaterial: THREE.MeshBasicMaterial | null = null;
  private rebuildQueued = false;
  private idleMotion = true;
  private breathGain = 1;
  private nextBlinkAt = 2.1;
  private blinkStartedAt = -1;
  private cameraTween: {
    startedAt: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;
  private recording = false;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement, spec: AnimalSpec) {
    this.canvas = canvas;
    this.container = container;
    this.spec = spec;
    this.pose = spec.defaultPose;
    this.coat = spec.defaultCoat;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;

    this.scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
    const preset = VIEW_PRESETS['three-quarter'];
    this.camera.position.set(...preset.position);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...preset.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.15;
    this.controls.maxDistance = 6.5;
    this.controls.maxPolarAngle = 1.53;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.15;
    this.controls.addEventListener('start', () => {
      if (this.controls.autoRotate) {
        this.controls.autoRotate = false;
        this.onAutoRotateChange(false);
      }
    });

    this.addLights(this.scene);

    // Invisible shadow-catcher so the kitten is grounded in every backdrop.
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.ShadowMaterial({ opacity: 0.34 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.001;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    // Visible studio floor pool (hidden in Transparent mode).
    this.floorDisc = new THREE.Mesh(
      new THREE.CircleGeometry(4.4, 48),
      new THREE.MeshBasicMaterial({
        color: '#2b251f',
        transparent: true,
        alphaMap: makeRadialAlpha(),
        depthWrite: false,
      }),
    );
    this.floorDisc.rotation.x = -Math.PI / 2;
    this.floorDisc.position.y = -0.002;
    this.scene.add(this.floorDisc);

    const observer = new ResizeObserver(() => this.handleResize());
    observer.observe(this.container);
    this.handleResize();

    this.rebuild();
    this.loop();
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  setSpecies(spec: AnimalSpec): void {
    this.spec = spec;
    this.pose = spec.defaultPose;
    this.coat = spec.defaultCoat;
    this.tuning = null;
    this.rebuild();
  }

  setWeight(weight: number): void {
    this.weight = weight;
    this.requestRebuild();
  }

  setPose(pose: string): void {
    this.pose = pose;
    this.requestRebuild();
  }

  setCoat(coat: string): void {
    this.coat = coat;
    this.rebuild(); // coat changes swap materials — cheap to do immediately
  }

  setTuning(tuning: Partial<LegTuning> | null): void {
    this.tuning = tuning;
    this.requestRebuild();
  }

  setBackdrop(backdrop: BackdropId): void {
    this.backdrop = backdrop;
    this.floorDisc.visible = backdropById(backdrop).floorDisc;
  }

  setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
  }

  isAutoRotating(): boolean {
    return this.controls.autoRotate;
  }

  setIdleMotion(enabled: boolean): void {
    this.idleMotion = enabled;
  }

  /** Fur only / translucent fur + bones / skeleton only. */
  setSkeletonMode(mode: SkeletonMode): void {
    this.skeletonMode = mode;
    this.applySkeletonMode();
  }

  getSkeletonMode(): SkeletonMode {
    return this.skeletonMode;
  }

  setView(preset: ViewPreset): void {
    const next = VIEW_PRESETS[preset];
    this.cameraTween = {
      startedAt: this.clock.getElapsedTime(),
      duration: 0.7,
      fromPosition: this.camera.position.clone(),
      toPosition: new THREE.Vector3(...next.position),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(...next.target),
    };
    this.controls.enabled = false;
  }

  getState(): { weight: number; pose: string; coat: string; tuning: Partial<LegTuning> | null } {
    return { weight: this.weight, pose: this.pose, coat: this.coat, tuning: this.tuning };
  }

  /** Render the current view as a PNG blob (studio backdrop or alpha). */
  async snapshot(size = 2048): Promise<Blob | null> {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const previousPixelRatio = this.renderer.getPixelRatio();
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.render(this.scene, this.camera);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = size;
    exportCanvas.height = size;
    const ctx = exportCanvas.getContext('2d')!;
    const backdrop = backdropById(this.backdrop);
    if (backdrop.painted) paintBackdrop(ctx, size, size, backdrop);
    ctx.drawImage(this.renderer.domElement, 0, 0, size, size);

    this.renderer.setPixelRatio(previousPixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    return blobFromCanvas(exportCanvas);
  }

  /** Render the full weight × pose study sheet and return it as a PNG blob. */
  async renderContactSheet(): Promise<Blob | null> {
    const cellSize = 512;
    const columns = SHEET_COLUMNS;
    const rows = POSE_ORDER.map((pose) => ({ pose, label: POSE_PARAMS[pose as PoseId].label }));

    const cells: SheetCell[] = [];
    for (const row of rows) {
      for (const column of columns) {
        cells.push({
          pose: row.pose,
          weight: column.weight,
          weightName: column.name,
          canvas: this.renderSheetCell(row.pose as PoseId, column.weight, cellSize),
        });
      }
    }
    const sheet = composeContactSheet(
      cells,
      columns,
      rows,
      'Kitten — a weight × pose study',
      'procedural geometry · same cat at five body conditions',
    );
    return blobFromCanvas(sheet);
  }

  /** Record one full turntable revolution to a WebM blob. */
  async recordTurntable(seconds = 4.6): Promise<Blob | null> {
    if (this.recording) return null;
    const stream = this.canvas.captureStream(60);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) return null;

    this.recording = true;
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const finished = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = () => resolve(null);
    });

    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = (2 * 30) / seconds; // exactly one orbit
    recorder.start(200);
    await new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
    recorder.stop();
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 1.15;
    this.recording = false;
    this.onAutoRotateChange(false);
    return finished;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private addLights(scene: THREE.Scene): void {
    const hemi = new THREE.HemisphereLight(0x8a7a68, 0x191411, 0.55);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0dc, 1.4);
    key.position.set(2.4, 3.9, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2.4;
    key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -2.4;
    key.shadow.camera.near = 0.4;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 6;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xbfd0e8, 0.42);
    fill.position.set(-2.8, 1.6, 1.9);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffd9a4, 0.85);
    rim.position.set(-0.7, 2.7, -3.1);
    scene.add(rim);
  }

  private handleResize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private applySkeletonMode(): void {
    const restoreWeights = (): void => this.restoreWeights();
    // Lazily create the skeleton once; it is static (standing rest pose) and lives in the mesh's frame.
    if (!this.skeletonGroup) {
      this.skeletonGroup = buildSkeletonGroup();
      this.skeletonGroup.visible = false;
      this.scene.add(this.skeletonGroup);
    }
    const bones = this.skeletonGroup;
    const internals = this.internals;
    const skinMat = internals?.skinMesh.material as THREE.MeshStandardMaterial | undefined;

    const restoreFur = (): void => {
      if (skinMat && this.furFade) {
        skinMat.transparent = this.furFade.transparent;
        skinMat.opacity = this.furFade.opacity;
        skinMat.depthWrite = this.furFade.depthWrite;
        skinMat.needsUpdate = true;
        this.furFade = null;
      }
    };

    restoreFur();
    restoreWeights();

    if (this.skeletonMode === 'off') {
      bones.visible = false;
      if (internals) internals.breathRoot.visible = true;
      return;
    }

    if (this.skeletonMode === 'weights') {
      // Paint the skin by dominant bone (region hues) — a debug readout of the
      // analytic weights that will drive the skinning rig.
      bones.visible = false;
      if (internals) {
        internals.breathRoot.visible = true;
        internals.openEyes.visible = false;
        this.paintWeights();
      }
      return;
    }

    bones.visible = true;
    if (this.skeletonMode === 'bones-only') {
      if (internals) internals.breathRoot.visible = false;
      return;
    }

    // overlay: fur stays, ghosted so the bones read through.
    if (internals) internals.breathRoot.visible = true;
    if (skinMat) {
      this.furFade = { transparent: skinMat.transparent, opacity: skinMat.opacity, depthWrite: skinMat.depthWrite };
      skinMat.transparent = true;
      skinMat.opacity = 0.16;
      skinMat.depthWrite = false;
      skinMat.needsUpdate = true;
    }
  }

  /** Swap the skin to the bone-weight debug palette (idempotent per geometry). */
  private paintWeights(): void {
    const internals = this.internals;
    if (!internals) return;
    const mesh = internals.skinMesh;
    const geometry = mesh.geometry;
    const store = geometry.userData as {
      originalColors?: Float32Array;
      originalMaterial?: THREE.Material | THREE.Material[];
    };
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colorAttr) return;
    if (!store.originalColors) {
      store.originalColors = new Float32Array(colorAttr.array as Float32Array);
      store.originalMaterial = mesh.material;
      const sw = computeSkinWeights(geometry.getAttribute('position') as THREE.BufferAttribute);
      paintBoneWeightColors(colorAttr.array as Float32Array, sw);
      colorAttr.needsUpdate = true;
    }
    if (!this.weightsMaterial) {
      this.weightsMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    }
    if (mesh.material !== this.weightsMaterial) mesh.material = this.weightsMaterial;
  }

  private restoreWeights(): void {
    const internals = this.internals;
    if (!internals) return;
    const mesh = internals.skinMesh;
    const geometry = mesh.geometry;
    const store = geometry.userData as {
      originalColors?: Float32Array;
      originalMaterial?: THREE.Material | THREE.Material[];
    };
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (store.originalColors && colorAttr) {
      (colorAttr.array as Float32Array).set(store.originalColors);
      colorAttr.needsUpdate = true;
      delete store.originalColors;
    }
    if (store.originalMaterial) {
      mesh.material = store.originalMaterial;
      delete store.originalMaterial;
    }
    internals.openEyes.visible = true;
  }

  private requestRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.rebuild();
    });
  }

  private rebuild(): void {
    const previous = this.current;
    const next = this.spec.build({ weight: this.weight, pose: this.pose, coat: this.coat, tuning: this.tuning ?? undefined });
    if (previous) {
      this.scene.remove(previous.group);
      previous.dispose();
    }
    this.scene.add(next.group);
    this.current = next;
    this.internals = (next.group.userData.internals ?? null) as KittenInternals | null;
    this.applySkeletonMode();
    this.onMetrics(next.metrics);
  }

  /** Render one contact-sheet cell to a transparent canvas. */
  private renderSheetCell(pose: PoseId, weight: number, size: number): HTMLCanvasElement {
    const scene = new THREE.Scene();
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.5;
    this.addLights(scene);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    const build = this.spec.build({ weight, pose, coat: this.coat });
    scene.add(build.group);

    // Framing tuned per pose so reclining cats aren't lost in the frame.
    const framing: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
      standing: { pos: [1.44, 1.22, 1.96], target: [0, 0.4, 0] },
      sitting: { pos: [1.44, 1.16, 1.96], target: [0, 0.38, 0] },
      loaf: { pos: [1.34, 1.06, 1.8], target: [0, 0.26, 0] },
      stretch: { pos: [1.44, 1.3, 1.96], target: [0, 0.42, 0] },
      curled: { pos: [1.3, 1.04, 1.74], target: [0, 0.23, 0] },
    };
    const frame = framing[pose] ?? framing.standing;
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 20);
    camera.position.set(...frame.pos);
    camera.lookAt(new THREE.Vector3(...frame.target));

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const previousPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.render(scene, camera);

    const cell = document.createElement('canvas');
    cell.width = size;
    cell.height = size;
    cell.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, size, size);

    // Clean up the throwaway scene so 25 builds don't accumulate.
    build.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    this.renderer.setPixelRatio(previousPixelRatio);
    this.renderer.setSize(width, height, false);

    return cell;
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Camera tween (view preset changes)
    if (this.cameraTween) {
      const tween = this.cameraTween;
      const t = Math.min(1, (elapsed - tween.startedAt) / tween.duration);
      const eased = smoothstep(t);
      this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
      this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      if (t >= 1) {
        this.cameraTween = null;
        this.controls.enabled = true;
      }
    }

    this.controls.update();

    // Idle motion: breathing + blinking. The skin is one mesh, so the whole
    // body swells together; a relaxed cat blinks every few seconds.
    const targetGain = this.idleMotion ? 1 : 0;
    this.breathGain += (targetGain - this.breathGain) * Math.min(1, delta * 3.2);
    const gain = this.breathGain;
    const internals = this.internals;
    if (internals) {
      const breath = Math.sin(elapsed * 1.35) * gain;
      // Whole assembly breathes (skin + eyes + whiskers + nose …),
      // pivoted at the floor contact plane so features never drift on the fur.
      internals.breathRoot.scale.set(1 + breath * 0.010, 1 + breath * 0.016, 1 + breath * 0.010);

      // Blinking — a monolid wipe: scaling the squash group collapses the eye
      // onto its lower rim, top-down. The eyeball never translates.
      const setLid = (value: number) => {
        for (const eye of internals.openEyes.children) {
          const squash = eye.userData.squash as THREE.Group | undefined;
          if (!squash) continue;
          squash.scale.y = 1 - value * 0.93; // 1 → 0.07 (a closed-eye line)
        }
      };
      if (internals.openEyes.visible) {
        if (this.blinkStartedAt < 0 && elapsed >= this.nextBlinkAt) {
          this.blinkStartedAt = elapsed;
        }
        if (this.blinkStartedAt >= 0) {
          const p = (elapsed - this.blinkStartedAt) / 0.24;
          if (p >= 1) {
            setLid(0);
            this.blinkStartedAt = -1;
            this.nextBlinkAt = elapsed + 2.3 + Math.random() * 3.1;
          } else {
            setLid(Math.sin(p * Math.PI));
          }
        }
      } else {
        setLid(0);
        this.blinkStartedAt = -1;
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}

function makeRadialAlpha(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.55, '#b4b4b4');
  gradient.addColorStop(1, '#000000');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}
