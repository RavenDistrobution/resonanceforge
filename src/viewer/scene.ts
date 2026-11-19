// Three.js viewport: Z-up print bed, orbit + transform gizmo, selection, paint and placement picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { project, type Part } from '../core/project';

export type ViewerMode = 'select' | 'paint' | 'place' | 'draw';
export type DrawPhase = 'down' | 'move' | 'up' | 'dbl';
export interface Hit { part: Part; faceIndex: number; point: THREE.Vector3; normal: THREE.Vector3 }

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  gizmo: TransformControls;
  bed = new THREE.Group();
  bedSize: [number, number] = [256, 256];
  mode: ViewerMode = 'select';
  onPaint: ((hit: Hit, start: boolean) => void) | null = null;
  onPlace: ((hit: Hit) => void) | null = null;
  onTransform: (() => void) | null = null;
  onDraw: ((phase: DrawPhase, ray: THREE.Ray, e: PointerEvent | MouseEvent, hit: Hit | null) => void) | null = null;
  private drawing = false;
  private spaceHeld = false;
  private ray = new THREE.Raycaster();
  private downPos = new THREE.Vector2();
  private painting = false;
  private partsGroup = new THREE.Group();

  constructor(public el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(220, -260, 190);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 20);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.12;
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace('world');
    this.gizmo.addEventListener('dragging-changed', (e: any) => { this.orbit.enabled = !e.value; });
    this.gizmo.addEventListener('objectChange', () => { this.onTransform?.(); });
    this.scene.add(this.gizmo.getHelper());
    this.scene.add(this.partsGroup);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(180, -120, 300); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -300; sun.shadow.camera.right = 300; sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300; sun.shadow.camera.far = 1000; sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-200, 150, 120); this.scene.add(fill);
    this.scene.add(this.bed);
    this.buildBed();

    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dblclick', (e) => { if (this.mode === 'draw') this.onDraw?.('dbl', this.rayFrom(e), e, null); });
    window.addEventListener('keydown', (e) => { if (e.key === ' ' && !(e.target as HTMLElement)?.matches?.('input,textarea,select')) { this.spaceHeld = true; if (this.mode !== 'select') e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this.spaceHeld = false; });
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.renderer.setAnimationLoop(() => { this.orbit.update(); this.renderer.render(this.scene, this.camera); });
    project.onChange(() => this.sync());
  }

  setBedSize(w: number, d: number) { this.bedSize = [w, d]; this.buildBed(); }

  private buildBed() {
    this.bed.clear();
    const [w, d] = this.bedSize;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xdfe4ec, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.85 }));
    plate.position.z = -0.05; plate.receiveShadow = true; this.bed.add(plate);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d) / 10, 0x8a94a6, 0xc3cad6);
    grid.rotation.x = Math.PI / 2; grid.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.6;
    this.bed.add(grid);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)), new THREE.LineBasicMaterial({ color: 0x2a78d6 }));
    this.bed.add(outline);
    const axes = new THREE.AxesHelper(25); axes.position.set(-w / 2, -d / 2, 0.1); this.bed.add(axes);
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Keep scene objects in step with project parts and selection. */
  sync() {
    const live = new Set(project.parts.map((p) => p.object));
    for (const child of [...this.partsGroup.children]) if (!live.has(child as THREE.Mesh)) this.partsGroup.remove(child);
    for (const p of project.parts) {
      if (p.object.parent !== this.partsGroup) this.partsGroup.add(p.object);
      p.object.visible = p.visible;
      const mat = p.object.material as THREE.MeshStandardMaterial;
      const sel = project.selection.includes(p.id);
      mat.emissive.set(sel ? (project.selection[0] === p.id ? 0x2a78d6 : 0xeb6834) : 0x000000);
      mat.emissiveIntensity = sel ? 0.18 : 0;
    }
    const prim = project.primary;
    if (prim && prim.visible && this.mode === 'select') { if (this.gizmo.object !== prim.object) this.gizmo.attach(prim.object); }
    else this.gizmo.detach();
  }

  /** Tool modes keep the camera free: right-drag orbits, middle-drag pans, wheel zooms, Space + left-drag orbits. */
  setMode(m: ViewerMode) {
    this.mode = m; this.sync(); this.renderer.domElement.style.cursor = m === 'select' ? 'default' : 'crosshair';
    if (m !== 'draw') { this.drawing = false; this.orbit.enabled = true; }
    this.orbit.mouseButtons = m === 'select' ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  }
  setGizmoMode(m: 'translate' | 'rotate' | 'scale') { this.gizmo.setMode(m); }

  rayFrom(e: { clientX: number; clientY: number }): THREE.Ray {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.clone();
  }

  pick(e: { clientX: number; clientY: number }): Hit | null {
    this.rayFrom(e);
    const hits = this.ray.intersectObjects(this.partsGroup.children.filter((o) => o.visible), false);
    if (!hits.length) return null;
    const h = hits[0];
    const part = project.byId((h.object as THREE.Mesh).userData.partId);
    if (!part) return null;
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize() : new THREE.Vector3(0, 0, 1);
    return { part, faceIndex: h.faceIndex ?? 0, point: h.point.clone(), normal };
  }

  private pointerDown(e: PointerEvent) {
    this.downPos.set(e.clientX, e.clientY);
    if (this.spaceHeld && e.button === 0) return; // Space + left drag: let OrbitControls rotate
    if (this.mode === 'draw' && e.button === 0) { this.drawing = true; this.orbit.enabled = false; this.onDraw?.('down', this.rayFrom(e), e, this.pick(e)); return; }
    if (this.mode === 'paint' && e.button === 0) {
      const hit = this.pick(e);
      if (hit) { this.painting = true; this.orbit.enabled = false; this.onPaint?.(hit, true); }
    }
  }
  private pointerMove(e: PointerEvent) {
    if (this.drawing) { this.onDraw?.('move', this.rayFrom(e), e, null); return; }
    if (this.mode === 'draw') { if (!this.spaceHeld) this.onDraw?.('move', this.rayFrom(e), e, null); return; }
    if (this.painting) { const hit = this.pick(e); if (hit) this.onPaint?.(hit, false); }
  }
  private pointerUp(e: PointerEvent) {
    if (this.drawing) { this.drawing = false; this.orbit.enabled = true; this.onDraw?.('up', this.rayFrom(e), e, this.pick(e)); return; }
    if (this.painting) { this.painting = false; this.orbit.enabled = true; return; }
    if (e.button !== 0) return;
    if (this.downPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return; // drag, not click
    if (this.gizmo.dragging) return;
    const hit = this.pick(e);
    if (this.mode === 'place') { if (hit) this.onPlace?.(hit); return; }
    if (this.mode === 'select') {
      if (hit) project.select([hit.part.id], e.shiftKey);
      else if (!e.shiftKey) project.select([]);
    }
  }

  fitView(parts?: Part[]) {
    const list = (parts && parts.length ? parts : project.parts).filter((p) => p.visible);
    const box = new THREE.Box3();
    if (!list.length) box.set(new THREE.Vector3(-this.bedSize[0] / 2, -this.bedSize[1] / 2, 0), new THREE.Vector3(this.bedSize[0] / 2, this.bedSize[1] / 2, 50));
    else for (const p of list) { p.object.updateMatrixWorld(); box.expandByObject(p.object); }
    const size = box.getSize(new THREE.Vector3()).length() || 50;
    const center = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(dir.multiplyScalar(size * 1.3 + 20));
    this.camera.near = 0.1; this.camera.far = size * 20 + 2000; this.camera.updateProjectionMatrix();
  }

  screenshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}
