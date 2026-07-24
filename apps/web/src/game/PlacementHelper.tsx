import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export type PlacementKind =
  | "spawn"
  | "shop"
  | "spells"
  | "customization"
  | "talents"
  | "portal_pvp"
  | "portal_pve"
  | "dummy";

export type PlacedMarker = {
  kind: PlacementKind;
  x: number;
  z: number;
};

const KINDS: PlacementKind[] = [
  "spawn",
  "shop",
  "spells",
  "customization",
  "talents",
  "portal_pvp",
  "portal_pve",
  "dummy",
];

const KIND_COLOR: Record<PlacementKind, string> = {
  spawn: "#d4edda",
  shop: "#f5e6b8",
  spells: "#c5d8f0",
  customization: "#edd0e0",
  talents: "#d9d0f0",
  portal_pvp: "#f0c4c4",
  portal_pve: "#c8e6c9",
  dummy: "#e0ddd8",
};

function formatDump(markers: PlacedMarker[]): string {
  const lines = markers.map(
    (m) =>
      `  { kind: "${m.kind}", x: ${m.x.toFixed(3)}, z: ${m.z.toFixed(3)} }, // world`,
  );
  return `[\n${lines.join("\n")}\n]`;
}

function PlacementHud({ kind }: { kind: PlacementKind }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        zIndex: 60,
        maxWidth: 380,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(8,12,20,0.85)",
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 12,
        lineHeight: 1.45,
        border: "1px solid rgba(148,163,184,0.35)",
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Placement helper (F4)</div>
      <div>
        Kind: <span style={{ color: KIND_COLOR[kind] }}>{kind}</span> — keys 1–8
      </div>
      <div>Click ground to place / replace that kind</div>
      <div>C = copy dump · Backspace = undo</div>
      <div style={{ opacity: 0.75, marginTop: 4 }}>
        Paste the copied list in chat to wire spawn / UI spots.
      </div>
    </div>
  );
}

/**
 * Hub placement helper — F4 toggle.
 * 1–8 select kind, click ground to drop a marker, C copies JSON, Backspace undoes.
 * Paste the dump in chat so spots can be wired into stands/spawn.
 */
export function PlacementHelper() {
  const [active, setActive] = useState(false);
  const [kindIdx, setKindIdx] = useState(0);
  const [markers, setMarkers] = useState<PlacedMarker[]>([]);
  const hudRootRef = useRef<Root | null>(null);
  const { camera, gl } = useThree();
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const kind = KINDS[kindIdx]!;

  const copyDump = useCallback((list: PlacedMarker[]) => {
    const text = formatDump(list);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    console.log("[PlacementHelper]\n" + text);
    (window as unknown as { __bbPlacements?: PlacedMarker[] }).__bbPlacements = list;
  }, []);

  useEffect(() => {
    const host = document.createElement("div");
    host.id = "bb-placement-hud";
    document.body.appendChild(host);
    hudRootRef.current = createRoot(host);
    return () => {
      hudRootRef.current?.unmount();
      hudRootRef.current = null;
      host.remove();
    };
  }, []);

  useEffect(() => {
    const root = hudRootRef.current;
    if (!root) return;
    if (active) root.render(<PlacementHud kind={kind} />);
    else root.render(null);
  }, [active, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "F4") {
        e.preventDefault();
        setActive((v) => !v);
        return;
      }
      if (!active) return;
      if (e.code === "KeyC" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        copyDump(markers);
        return;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        e.preventDefault();
        setMarkers((prev) => {
          const next = prev.slice(0, -1);
          copyDump(next);
          return next;
        });
        return;
      }
      const digit = e.code.match(/^Digit([1-8])$/);
      if (digit) {
        e.preventDefault();
        setKindIdx(Number(digit[1]) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    (window as unknown as { __bbTogglePlacement?: () => void }).__bbTogglePlacement = () =>
      setActive((v) => !v);
    return () => {
      window.removeEventListener("keydown", onKey);
      delete (window as unknown as { __bbTogglePlacement?: () => void }).__bbTogglePlacement;
    };
  }, [active, copyDump, markers]);

  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const onClick = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
      const marker: PlacedMarker = {
        kind,
        x: Number(hit.x.toFixed(3)),
        z: Number(hit.z.toFixed(3)),
      };
      setMarkers((prev) => {
        const next = [...prev.filter((m) => m.kind !== kind), marker];
        copyDump(next);
        return next;
      });
    };
    el.addEventListener("pointerdown", onClick);
    return () => el.removeEventListener("pointerdown", onClick);
  }, [active, camera, copyDump, gl, groundPlane, hit, kind, raycaster]);

  return (
    <>
      {markers.map((m) => (
        <mesh
          key={`${m.kind}-${m.x}-${m.z}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[m.x, 0.02, m.z]}
        >
          <circleGeometry args={[1.6, 40]} />
          <meshBasicMaterial
            color={KIND_COLOR[m.kind]}
            transparent
            opacity={0.38}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  );
}
