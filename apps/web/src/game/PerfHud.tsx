/**
 * In-game frame profiler, toggled with F9.
 *
 * Exists because "the client lags" is not something you can act on. What you
 * can act on is knowing whether a fight costs you draw calls, triangles, or a
 * shader compile -- those have completely different fixes, and guessing
 * between them is how you end up rewriting a renderer that was never the
 * problem.
 *
 * Deliberately reports the worst frame in the window alongside the average.
 * Average FPS hides exactly the thing that feels bad: a 120 ms hitch the
 * moment someone casts, which a 60-frame mean barely moves.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import {
  SPIKE_MS,
  getExtraLine,
  getPerfLatest,
  isOverlayOn,
  samplingActive,
  setLatestSample,
  setOverlayEnabled,
  subscribePerfData,
  subscribePerfToggle,
} from "./perfHudRuntime";

const WINDOW = 180;
/**
 * Frames longer than this are the tab being backgrounded, not the game being
 * slow. Counting them would let one alt-tab poison the peak for the session.
 */
const THROTTLE_MS = 500;

/** Subscribe to the on/off flag. Kept off the data channel to avoid 5 Hz churn. */
function useEnabled(): boolean {
  const [on, setOn] = useState(isOverlayOn);
  useEffect(() => subscribePerfToggle(() => setOn(isOverlayOn())), []);
  return on;
}

function useSampling(): boolean {
  const [on, setOn] = useState(samplingActive);
  useEffect(() => subscribePerfToggle(() => setOn(samplingActive())), []);
  return on;
}

/**
 * Find which material in the scene a freshly linked program belongs to.
 *
 * Program cache keys identify a *variant*, not a source file, and every custom
 * VFX shader reports the same blank name -- so the key alone cannot tell you
 * which factory to warm. Uniform names can: `uSpokes` is the rune, `uEdge` is
 * the rim marker. Only runs when a new program appears, so the traversal cost
 * is paid once per compile rather than once per frame.
 */
function describeProgram(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  program: unknown,
): string | null {
  let found: string | null = null;

  scene.traverse((obj) => {
    if (found) return;
    const raw = (obj as THREE.Mesh).material;
    if (!raw) return;
    for (const mat of Array.isArray(raw) ? raw : [raw]) {
      const current = (gl.properties.get(mat) as { currentProgram?: unknown })?.currentProgram;
      if (current !== program) continue;
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      const keys = uniforms ? Object.keys(uniforms).filter((k) => k.startsWith("u")) : [];
      found = `${mat.type}${mat.name ? ` "${mat.name}"` : ""} on <${obj.name || obj.type}>${
        keys.length ? ` uniforms: ${keys.slice(0, 8).join(",")}` : ""
      }`;
      return;
    }
  });

  return found;
}

/** Per-frame sampler. Must live inside the Canvas. */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const on = useSampling();
  const frames = useRef<number[]>([]);
  const peak = useRef({ ms: 0, calls: 0 });
  const acc = useRef(0);
  const seenPrograms = useRef(new Set<string>());
  const newPrograms = useRef(0);

  /*
   * Manual reset is what makes the draw-call count mean anything here. The
   * scene runs through an EffectComposer, and on auto-reset every pass wipes
   * the counter, so a read only ever sees the final fullscreen blit -- one
   * call, no triangles, regardless of what the frame actually cost.
   */
  useEffect(() => {
    if (!on) return;
    const info = gl.info;
    const previous = info.autoReset;
    info.autoReset = false;

    // A fresh session each time it is opened, so a peak from an earlier look
    // (or an alt-tab) does not carry over.
    frames.current = [];
    peak.current = { ms: 0, calls: 0 };
    newPrograms.current = 0;
    seenPrograms.current = new Set(
      (info.programs ?? []).map((p) => String((p as { cacheKey?: string }).cacheKey ?? p.name)),
    );
    info.reset();

    return () => {
      info.autoReset = previous;
      info.reset();
    };
  }, [gl, on]);

  useFrame((_, delta) => {
    if (!samplingActive()) return;

    const ms = delta * 1000;
    const { render, memory, programs } = gl.info;
    const calls = render.calls;

    /*
     * Any program linked while playing is a hitch waiting to happen, so name
     * it in the console: the cache key is the only thing that identifies which
     * material variant the warmup in preloadVfx.ts failed to cover.
     */
    for (const p of programs ?? []) {
      const key = String((p as { cacheKey?: string }).cacheKey ?? p.name);
      if (seenPrograms.current.has(key)) continue;
      seenPrograms.current.add(key);
      newPrograms.current++;
      const who = describeProgram(gl, scene, p);
      console.warn(`[perf] shader compiled mid-session: ${who ?? (p.name || "?")}`, key);
    }

    gl.info.reset();

    // Backgrounded tabs report multi-second frames. Recording one would pin
    // the peak forever and drag the average with it.
    if (ms > THROTTLE_MS) return;

    const buf = frames.current;
    buf.push(ms);
    if (buf.length > WINDOW) buf.shift();

    if (ms > peak.current.ms) peak.current = { ms, calls };

    // Recomputing percentiles every frame would cost more than the render we
    // are trying to measure, so the summary lands ~5x a second.
    acc.current += delta;
    if (acc.current < 0.2) return;
    acc.current = 0;

    const sorted = [...buf].sort((a, b) => a - b);
    const sum = buf.reduce((t, v) => t + v, 0);

    setLatestSample({
      fps: buf.length / (sum / 1000),
      avgMs: sum / buf.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      worstMs: sorted[sorted.length - 1] ?? 0,
      spikes: buf.filter((v) => v > SPIKE_MS).length,
      calls,
      triangles: render.triangles,
      programs: programs?.length ?? 0,
      geometries: memory.geometries,
      textures: memory.textures,
      peakMs: peak.current.ms,
      peakCalls: peak.current.calls,
      newPrograms: newPrograms.current,
    });
  });

  return null;
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ color: warn ? "#ff6b6b" : "#d7e6f2", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

/** DOM overlay. Mount outside the Canvas; F9 toggles it. */
export function PerfOverlay() {
  const [, bump] = useState(0);
  const on = useEnabled();

  useEffect(() => subscribePerfData(() => bump((n) => n + 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F9") return;
      e.preventDefault();
      setOverlayEnabled(!isOverlayOn());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!on) return null;

  const s = getPerfLatest();
  const extraLine = getExtraLine();
  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: 9999,
        font: "500 11px ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#d7e6f2",
        background: "rgba(8,12,18,0.86)",
        border: "1px solid rgba(120,160,200,0.35)",
        borderRadius: 6,
        padding: "7px 9px",
        minWidth: 190,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div style={{ opacity: 0.5, marginBottom: 4 }}>PERF · F9</div>
      <Row label="fps" value={s.fps.toFixed(0)} warn={s.fps > 0 && s.fps < 50} />
      <Row label="frame avg" value={`${s.avgMs.toFixed(1)} ms`} />
      <Row label="frame p95" value={`${s.p95Ms.toFixed(1)} ms`} warn={s.p95Ms > SPIKE_MS} />
      <Row label="frame worst" value={`${s.worstMs.toFixed(1)} ms`} warn={s.worstMs > SPIKE_MS} />
      <Row label="hitches/3s" value={String(s.spikes)} warn={s.spikes > 0} />
      <div style={{ height: 5 }} />
      <Row label="draw calls" value={String(s.calls)} warn={s.calls > 400} />
      <Row label="triangles" value={s.triangles.toLocaleString()} />
      <Row label="programs" value={String(s.programs)} warn={s.programs > 220} />
      <Row label="compiled live" value={String(s.newPrograms)} warn={s.newPrograms > 0} />
      <Row label="geometries" value={String(s.geometries)} />
      <Row label="textures" value={String(s.textures)} />
      <div style={{ height: 5 }} />
      <Row label="peak frame" value={`${s.peakMs.toFixed(0)} ms`} warn={s.peakMs > 60} />
      <Row label="peak @ calls" value={String(s.peakCalls)} />
      {extraLine ? (
        <>
          <div style={{ height: 5 }} />
          <Row label={extraLine.label} value={extraLine.value} warn={extraLine.warn} />
        </>
      ) : null}
    </div>
  );
}
