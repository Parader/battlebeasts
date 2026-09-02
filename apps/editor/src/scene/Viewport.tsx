import {
  defaultElementShape,
  elementType,
  localToWorldXZ,
  mapGroundExtent,
  mapGroundSize,
  paramNumber,
  paramString,
  propUrlForKey,
} from "@battlebeasts/shared";
import { Environment, Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { colliderForPlacement } from "../props/collider";
import { usePropIndex } from "../props/manifest";
import { colliderOverrides } from "../props/overrides";
import { commitWall, docStore, nextId, rollYaw, snap, useEditor } from "../state/docStore";
import { terrain } from "../state/terrain";
import { wasDragged } from "./clickGuard";
import { CollisionOverlay } from "./CollisionOverlay";
import { Elements } from "./Elements";
import { GameViewSnap, OrientationCompass, OrientationProbe } from "./GameView";
import { GroupGizmo } from "./GroupGizmo";
import { Ground } from "./Ground";
import { Props } from "./Props";
import { ScaleReference } from "./ScaleReference";
import { CLOSE_SNAP_M, Walls } from "./Walls";

function Lights({ size }: { size: number }) {
  // Matched loosely to the game's outdoor lighting so props read the same here
  // as they will in a match.
  const d = size * 0.75;
  return (
    <>
      <hemisphereLight args={["#bcd7ff", "#4a4433", 0.85]} />
      <directionalLight
        position={[size * 0.35, size * 0.6, size * 0.25]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-d}
        shadow-camera-right={d}
        shadow-camera-top={d}
        shadow-camera-bottom={-d}
        shadow-camera-far={size * 2}
        shadow-bias={-0.0004}
      />
    </>
  );
}

/**
 * Translucent footprint showing where the armed prop will land. Sized to the
 * fitted collider so it doubles as a check that the prop will actually fit.
 */
function PlacementGhost({ x, z, radius }: { x: number; z: number; radius: number }) {
  return (
    <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <ringGeometry args={[Math.max(0.05, radius - 0.04), Math.max(0.09, radius), 40]} />
      <meshBasicMaterial color="#6aa9ff" transparent opacity={0.8} depthTest={false} />
    </mesh>
  );
}

/**
 * Translucent model at the cursor, so a prop is identifiable before it lands.
 *
 * Suspends while the GLB loads and the footprint ring carries the preview in
 * the meantime. Loading here is not wasted: placing the prop needs the same
 * asset, so the cache is already warm by the time you click.
 *
 * Drawn at the exact yaw and position the prop will get: the facing is rolled
 * when the prop is armed rather than on click, so this is a true preview
 * rather than an approximation.
 */
function GhostModel({
  url,
  x,
  y,
  z,
  yaw,
  pivotX,
  pivotZ,
}: {
  url: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pivotX: number;
  pivotZ: number;
}) {
  const gltf = useGLTF(url);

  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      /*
       * Invisible to the raycaster, or the preview feeds back into itself:
       * hover reads `e.point.y` from whatever the ray hits, and once that is
       * the ghost it lifts to its own surface, shifting the next hit and
       * making it jitter.
       */
      mesh.raycast = () => {};
      // Materials are cloned because the GLB is shared with placed props --
      // ghosting the originals would fade every copy already on the map.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const faded = mats.map((m) => {
        const g = m.clone() as THREE.MeshStandardMaterial;
        g.transparent = true;
        g.opacity = 0.45;
        g.depthWrite = false;
        return g;
      });
      mesh.material = Array.isArray(mesh.material) ? faded : faded[0]!;
    });
    return clone;
  }, [gltf]);

  // Same nesting as a placed prop, so the preview is the placement.
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <primitive object={scene} position={[-pivotX, 0, -pivotZ]} />
    </group>
  );
}

/**
 * Ring showing the brush footprint, so you can judge coverage before painting.
 */
function BrushCursor({ x, z, radius }: { x: number; z: number; radius: number }) {
  return (
    <mesh position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <ringGeometry args={[Math.max(0.05, radius - 0.08), radius, 48]} />
      <meshBasicMaterial color="#ffd479" transparent opacity={0.9} depthTest={false} />
    </mesh>
  );
}

/** Ground plus the click-to-plant behaviour that targets it. */
function GroundLayer() {
  const { doc, tool, brushProp, brush, gridSnap, angleSnap, wallDraft, ghostYaw, stickyCollider } =
    useEditor();
  const { index } = usePropIndex();
  // Snapped, so this only re-renders when the ghost actually moves a cell.
  const [hover, setHover] = useState<{ x: number; z: number; y: number } | null>(null);
  // Unsnapped, because a brush should follow the cursor smoothly.
  const [brushAt, setBrushAt] = useState<{ x: number; z: number } | null>(null);
  const painting = useRef(false);

  const armed = tool === "place" && brushProp ? index?.byKey.get(brushProp) : undefined;
  const canPaint = tool === "paint" && doc.ground.kind === "painted";

  // Fresh facing whenever a different prop is armed, so arrow-keying through a
  // family does not show every variant at the same angle.
  useEffect(() => {
    if (brushProp) docStore.setUi({ ghostYaw: rollYaw(angleSnap) });
  }, [brushProp, angleSnap]);

  /*
   * Where the collider will land, relative to the cursor.
   *
   * The model itself lands centred on the cursor, so this is purely the base
   * slice's offset from the centre -- nonzero for anything whose mass sits to
   * one side, like an L-shaped house.
   */
  const ghostColliderAt = useMemo(() => {
    if (!armed) return { x: 0, z: 0 };
    const spec = colliderForPlacement(armed, stickyCollider, colliderOverrides.get(armed.key));
    if (spec.mode === "none") return { x: 0, z: 0 };
    return localToWorldXZ(0, 0, ghostYaw, spec.offsetX ?? 0, spec.offsetZ ?? 0);
  }, [armed, ghostYaw, stickyCollider]);

  /*
   * Painting owns the left button outright while the paint tool is active.
   *
   * Every other tool defers to `wasDragged` so a camera orbit does not place a
   * prop, but a brush stroke *is* a drag -- the two cannot share the gesture.
   * OrbitControls is disabled for the duration instead, leaving middle-drag
   * and right-drag to move the camera.
   */
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!canPaint || e.button !== 0) return;
    e.stopPropagation();
    painting.current = true;
    docStore.setUi({ orbitLocked: true });
    terrain.beginStroke();
    terrain.stamp(e.point.x, e.point.z, brush);
  };

  const endStroke = () => {
    if (!painting.current) return;
    painting.current = false;
    docStore.setUi({ orbitLocked: false });
    terrain.endStroke();
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (canPaint) {
      setBrushAt({ x: e.point.x, z: e.point.z });
      if (painting.current) {
        e.stopPropagation();
        terrain.stamp(e.point.x, e.point.z, brush);
      }
      return;
    }
    if (brushAt) setBrushAt(null);

    const x = snap(e.point.x, gridSnap);
    const z = snap(e.point.z, gridSnap);

    if (tool === "wall") {
      if (wallDraft) docStore.setUi({ wallCursor: [x, z] });
      return;
    }
    if (!armed) {
      if (hover) setHover(null);
      return;
    }
    // y comes along so the ghost model sits on sculpted ground, not on y=0.
    if (!hover || hover.x !== x || hover.z !== z) setHover({ x, z, y: e.point.y });
  };

  // A stroke that ends off-canvas still has to be committed, or the next one
  // would fold into it and undo would jump two strokes back.
  useEffect(() => {
    if (!canPaint) return;
    window.addEventListener("pointerup", endStroke);
    window.addEventListener("pointercancel", endStroke);
    return () => {
      window.removeEventListener("pointerup", endStroke);
      window.removeEventListener("pointercancel", endStroke);
    };
  });

  /** Append a point, or close the loop when clicking back on the start. */
  const addWallPoint = (px: number, pz: number) => {
    const x = snap(px, gridSnap);
    const z = snap(pz, gridSnap);
    const draft = wallDraft ?? [];

    const first = draft[0];
    if (first && draft.length > 2 && Math.hypot(x - first[0], z - first[1]) <= CLOSE_SNAP_M) {
      commitWall(draft, true);
      return;
    }
    // Ignore a repeat click on the same grid cell; it would make a zero-length
    // segment that contributes nothing to the collider.
    const last = draft[draft.length - 1];
    if (last && last[0] === x && last[1] === z) return;

    docStore.setUi({ wallDraft: [...draft, [x, z]], wallCursor: [x, z] });
  };

  const addElement = (x: number, z: number, y: number) => {
    const ui = docStore.getSnapshot();
    const def = elementType(ui.elementType);
    if (!def) return;

    // Default to facing the middle of the map: a spawn staring at the far wall
    // is the most common thing to forget to fix.
    const yaw = def.facing ? Math.atan2(-z, -x) : 0;
    const params = { ...ui.elementParams };

    // Slots must be unique per team, so the armed slot advances on each place
    // rather than stamping five spawns that all claim slot 0.
    if (ui.elementType === "player_spawn") {
      const team = String(params.team ?? "a");
      const used = new Set(
        doc.elements
          .filter((e) => e.type === "player_spawn" && paramString(e, "team", "a") === team)
          .map((e) => paramNumber(e, "slot")),
      );
      let slot = 0;
      while (used.has(slot)) slot++;
      params.slot = slot;
    }

    const id = nextId(doc, "e");
    docStore.edit((d) => {
      d.elements.push({
        id,
        type: ui.elementType,
        x,
        // Terrain height under the cursor, so an NPC on a hill stands on it.
        y,
        z,
        yaw,
        shape: defaultElementShape(def),
        params,
      });
    });

    if (ui.elementType === "player_spawn") {
      docStore.setUi({ selectedId: id, elementParams: { ...params, slot: params.slot as number } });
    } else {
      docStore.setUi({ selectedId: id });
    }
  };

  const ghostRadius = armed
    ? armed.defaultCollider.mode === "circle"
      ? armed.defaultCollider.radius
      : armed.defaultCollider.mode === "box"
        ? Math.hypot(armed.defaultCollider.halfX, armed.defaultCollider.halfZ)
        : Math.max(0.25, (armed.bounds.baseHx + armed.bounds.baseHz) / 2)
    : 0;

  // Acts on pointer up, and only when the gesture was not a camera drag.
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (canPaint) {
      endStroke();
      return;
    }
    if (e.button !== 0 || wasDragged()) return;

    if (tool === "wall") {
      e.stopPropagation();
      addWallPoint(e.point.x, e.point.z);
      return;
    }

    if (tool === "element") {
      e.stopPropagation();
      addElement(snap(e.point.x, gridSnap), snap(e.point.z, gridSnap), e.point.y);
      return;
    }

    if (tool !== "place" || !brushProp) {
      // Clicking empty ground clears the selection, as in every other editor.
      if (tool === "select") docStore.setUi({ selectedId: null });
      return;
    }

    const entry = index?.byKey.get(brushProp);
    if (!entry) return;
    e.stopPropagation();

    const x = snap(e.point.x, gridSnap);
    const z = snap(e.point.z, gridSnap);
    // Rolled when the prop was armed, not here, so the ghost showed exactly
    // the rotation you are about to get.
    const yaw = ghostYaw;

    const id = nextId(doc, "p");
    docStore.edit((d) => {
      d.props.push({
        id,
        prop: entry.key,
        // Straight from the cursor: the position is the prop's visible centre,
        // and the pivot below is what makes that true. Baked into the document
        // so the runtime never needs the manifest.
        x,
        y: e.point.y - entry.bounds.baseY,
        z,
        yaw,
        ...(entry.bounds.centreX ? { pivotX: entry.bounds.centreX } : {}),
        ...(entry.bounds.centreZ ? { pivotZ: entry.bounds.centreZ } : {}),
        scale: 1,
        // A correction saved for this model if there is one, else the last
        // collision choice made, else the fitted default.
        collider: colliderForPlacement(entry, stickyCollider, colliderOverrides.get(entry.key)),
      });
    });
    // Re-roll so the next placement is a different tree, and so the ghost
    // updates to show it.
    docStore.setUi({ selectedId: id, ghostYaw: rollYaw(angleSnap) });
  };

  return (
    <group
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        setHover(null);
        setBrushAt(null);
      }}
    >
      <Ground doc={doc} />
      {armed && hover && (
        <>
          {/*
            The ring shows the collider, and the collider lands on the model's
            base rather than at the cursor: the cursor is where the model's
            centre goes, and for a prop whose base sits off to one side those
            are different points.
          */}
          <PlacementGhost x={hover.x + ghostColliderAt.x} z={hover.z + ghostColliderAt.z} radius={ghostRadius} />
          <Suspense fallback={null}>
            <GhostModel
              key={armed.key}
              url={propUrlForKey(armed.key)}
              // Straight at the cursor, with the same pivot the placement will
              // store, so the preview is exactly what lands.
              x={hover.x}
              y={hover.y - armed.bounds.baseY}
              z={hover.z}
              pivotX={armed.bounds.centreX ?? 0}
              pivotZ={armed.bounds.centreZ ?? 0}
              yaw={ghostYaw}
            />
          </Suspense>
        </>
      )}
      {canPaint && brushAt && <BrushCursor x={brushAt.x} z={brushAt.z} radius={brush.radius} />}
    </group>
  );
}

/**
 * Flies the camera to whatever a panel asked to reveal.
 *
 * Lives inside the Canvas because `OrbitControls` is only reachable through
 * the R3F store; panels leave a `focusRequest` and this consumes it. The
 * camera keeps its current direction and distance, so clicking a warning
 * re-centres the view without also reorienting it.
 */
function FocusOnRequest() {
  const { doc, focusRequest } = useEditor();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!focusRequest || !controls) return;
    const { id } = focusRequest;

    const prop = doc.props.find((p) => p.id === id);
    const el = doc.elements.find((e) => e.id === id);
    const wall = doc.walls.find((w) => w.id === id);

    let target: THREE.Vector3 | null = null;
    if (prop) target = new THREE.Vector3(prop.x, prop.y, prop.z);
    else if (el) target = new THREE.Vector3(el.x, 0, el.z);
    else if (wall?.points.length) {
      const n = wall.points.length;
      const cx = wall.points.reduce((a, p) => a + p[0], 0) / n;
      const cz = wall.points.reduce((a, p) => a + p[1], 0) / n;
      target = new THREE.Vector3(cx, 0, cz);
    }

    docStore.setUi({ focusRequest: null });
    if (!target) return;

    // Preserve the current offset so the view slides rather than snapping to a
    // fixed angle, but pull in if we are further out than a prop-scale look.
    const offset = camera.position.clone().sub(controls.target);
    const dist = Math.min(offset.length(), 14);
    offset.setLength(Math.max(dist, 4));

    controls.target.copy(target);
    camera.position.copy(target).add(offset);
    controls.update();
  }, [focusRequest, controls, camera, doc]);

  return null;
}

export function Viewport() {
  const { doc, orbitLocked, showScaleRef } = useEditor();
  const extent = mapGroundExtent(doc);
  // Framing, fade and clip planes all key off the longest side, so a long map
  // still fits in view rather than being cropped along its major axis.
  const size = mapGroundSize(doc);

  return (
    <>
    <Canvas
      shadows
      dpr={[1, 1.5]}
      /*
       * Field of view matches the match camera's, so the only thing separating
       * this view from a player's is where it is pointed -- which is what the
       * compass and the game-view snap are for.
       */
      camera={{ position: [size * 0.45, size * 0.42, size * 0.45], fov: 45, near: 0.1, far: size * 6 }}
      gl={{ antialias: true }}
      /*
       * Hand keyboard focus back to the scene on any click in it.
       *
       * Arming a prop or changing a filter leaves focus on that palette
       * control, and the global shortcut handler ignores keys typed into form
       * elements -- so Delete silently did nothing on a prop you had just
       * placed, while the same key worked on one you had clicked.
       */
      onPointerDown={() => {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) active.blur();
      }}
    >
      <color attach="background" args={["#1b1f26"]} />

      <Lights size={size} />

      <Suspense fallback={null}>
        <GroundLayer />
      </Suspense>

      <Suspense fallback={null}>
        <Props />
        <Walls />
        <Elements />
      </Suspense>

      {showScaleRef && (
        <Suspense fallback={null}>
          <ScaleReference />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <Environment preset="park" environmentIntensity={0.35} />
      </Suspense>

      <Grid
        args={[extent.x, extent.z]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#3d4654"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#5b6b86"
        fadeDistance={size * 1.6}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />

      <CollisionOverlay doc={doc} />
      <FocusOnRequest />
      <GameViewSnap />
      <OrientationProbe />
      <GroupGizmo />

      <OrbitControls
        makeDefault
        /*
         * Left is deliberately unbound: it belongs to the tools (place,
         * select, wall points, brush strokes), and sharing it with the camera
         * meant every click had to be disambiguated from an orbit.
         *
         * Middle-drag orbits, right-drag pans, wheel zooms.
         */
        mouseButtons={{
          LEFT: undefined,
          MIDDLE: THREE.MOUSE.ROTATE,
          RIGHT: THREE.MOUSE.PAN,
        }}
        /*
         * Pan across the ground, not across the screen.
         *
         * Screen-space panning (the default) drags along the camera's own up
         * axis, so a pitched view climbs into the air as you drag back and the
         * map slides out from under you. Panning in the ground plane instead
         * keeps the camera at a constant height and moves it over X/Z -- the
         * same plane a player runs on -- which is what makes a right-drag
         * behave like walking the map rather than flying over it.
         */
        screenSpacePanning={false}
        enableRotate={!orbitLocked}
        enablePan={!orbitLocked}
        enableZoom
        zoomSpeed={0.9}
        // Stay above the horizon; going under the ground plane is only ever
        // an accident when you are placing props from above.
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={2}
        maxDistance={size * 2}
        enableDamping
        dampingFactor={0.12}
      />
    </Canvas>
    <OrientationCompass />
    </>
  );
}
