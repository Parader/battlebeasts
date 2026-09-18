import * as THREE from "three";

/**
 * One shared WebGL context for every palette thumbnail.
 *
 * A Canvas-per-row would exhaust the browser's context limit the first time
 * someone opens Buildings. Jobs run one per animation frame, and the snapshot
 * is copied onto the row's 2D canvas so scrolling does not keep a live scene.
 */

const SIZE = 96;

type Job = {
  url: string;
  source: THREE.Object3D;
  canvas: HTMLCanvasElement;
  cancelled: boolean;
};

const queue: Job[] = [];
const snapshots = new Map<string, HTMLCanvasElement>();
let draining = false;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _box = new THREE.Box3();

function ensureScene() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x161a21, 1);

  camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x3a2a1c, 1.15));
  const key = new THREE.DirectionalLight(0xfff4e5, 1.55);
  key.position.set(2.2, 3.4, 2.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9bb7ff, 0.45);
  fill.position.set(-2.4, 1.2, -1.6);
  scene.add(fill);
}

function blit(from: HTMLCanvasElement, to: HTMLCanvasElement) {
  if (to.width !== SIZE || to.height !== SIZE) {
    to.width = SIZE;
    to.height = SIZE;
  }
  const ctx = to.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(from, 0, 0);
}

function renderSnapshot(source: THREE.Object3D): HTMLCanvasElement | null {
  ensureScene();
  if (!renderer || !scene || !camera) return null;

  const root = source.clone(true);
  _box.setFromObject(root);
  if (_box.isEmpty()) return null;
  _box.getSize(_size);
  _box.getCenter(_center);
  root.position.x -= _center.x;
  root.position.y -= _center.y;
  root.position.z -= _center.z;
  root.updateMatrixWorld(true);

  const maxDim = Math.max(_size.x, _size.y, _size.z, 0.08);
  const dist = maxDim * 1.85;
  camera.position.set(dist * 0.74, dist * 0.58, dist * 0.92);
  camera.near = Math.max(0.02, dist / 40);
  camera.far = dist * 24;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  scene.add(root);
  renderer.render(scene, camera);
  scene.remove(root);

  const shot = document.createElement("canvas");
  shot.width = SIZE;
  shot.height = SIZE;
  const ctx = shot.getContext("2d");
  ctx?.drawImage(renderer.domElement, 0, 0);
  return shot;
}

function drain() {
  draining = true;
  const job = queue.shift();
  if (!job) {
    draining = false;
    return;
  }
  if (!job.cancelled) {
    let shot = snapshots.get(job.url);
    if (!shot) {
      shot = renderSnapshot(job.source) ?? undefined;
      if (shot) snapshots.set(job.url, shot);
    }
    if (shot && !job.cancelled) blit(shot, job.canvas);
  }
  if (queue.length) requestAnimationFrame(drain);
  else draining = false;
}

/** Paint `source` onto `canvas`. Returns a cancel function for unmount. */
export function requestPropThumb(
  url: string,
  source: THREE.Object3D,
  canvas: HTMLCanvasElement,
): () => void {
  const cached = snapshots.get(url);
  if (cached) {
    blit(cached, canvas);
    return () => {};
  }
  const job: Job = { url, source, canvas, cancelled: false };
  queue.push(job);
  if (!draining) requestAnimationFrame(drain);
  return () => {
    job.cancelled = true;
  };
}
