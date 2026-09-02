import {
  COLLISION,
  elementType,
  entityBehaviour,
  NPC_INTERACT_RADIUS,
  paramNumber,
  paramString,
  type MapElement,
  type MapTeam,
} from "@battlebeasts/shared";
import { Html, TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Suspense, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { docStore, selectEntity, useEditor } from "../state/docStore";
import { terrain } from "../state/terrain";
import { wasDragged } from "./clickGuard";
import { GROUND_NAME } from "./Ground";
import { NpcModel } from "./NpcModel";

/**
 * Every interactive point on the map -- spawns, stands, portals, objectives --
 * drawn from one renderer driven by the element catalog.
 *
 * There is deliberately no per-type component. The catalog says what colour a
 * type is, whether it has a trigger volume and whether its facing matters, so
 * a new element type renders correctly without touching this file.
 */

export const TEAM_COLOR: Record<MapTeam, string> = {
  a: "#4a9eff",
  b: "#ff5f5f",
  c: "#5fd08a",
};

const UNKNOWN_COLOR = "#ff9f43";

function elementColor(el: MapElement): string {
  const def = elementType(el.type);
  if (!def) return UNKNOWN_COLOR;
  if (def.teamColored) {
    const team = paramString(el, "team", "a");
    return TEAM_COLOR[team as MapTeam] ?? def.color;
  }
  return def.color;
}

/**
 * Short caption above the element. Prefers whatever param carries meaning for
 * the type so the viewport reads as "A0" / "Shop" / "zombie" rather than a
 * wall of identical type names.
 */
function elementLabel(el: MapElement): string {
  const def = elementType(el.type);
  if (!def) return el.type;
  if (el.type === "player_spawn") {
    return `${paramString(el, "team", "a").toUpperCase()}${paramNumber(el, "slot")}`;
  }
  if (el.type === "entity_spawn") {
    // Behaviour rides in the caption so a glance across the map tells you
    // which mobs hold their post and which will come at you.
    const marks: Record<string, string> = { fixed: "fixed", roam: "roams", guard: "guards" };
    return `${paramString(el, "entity", "entity")} · ${marks[entityBehaviour(el)]}`;
  }
  if (el.type === "npc") {
    // The action is the useful half: a town is read as "who sells things",
    // and half a dozen villagers named Villager tell you nothing.
    const action = paramString(el, "action", "talk");
    const name = paramString(el, "name", "Villager");
    return action === "talk" ? name : `${name} · ${action}`;
  }
  const custom =
    paramString(el, "label") || paramString(el, "entity") || paramString(el, "tag");
  return custom || def.label;
}

function Label({ text, color }: { text: string; color: string }) {
  return (
    <Html center distanceFactor={18} style={{ pointerEvents: "none", userSelect: "none" }}>
      <div
        style={{
          font: "600 12px ui-sans-serif, system-ui, sans-serif",
          color,
          background: "rgba(12,16,22,0.75)",
          border: `1px solid ${color}`,
          borderRadius: 4,
          padding: "1px 5px",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </Html>
  );
}

function Gizmo({
  object,
  onChange,
}: {
  object: THREE.Object3D | null;
  onChange: (o: THREE.Object3D) => void;
}) {
  const { gizmo, gridSnap, angleSnap } = useEditor();
  if (!object) return null;
  // Elements have no scale in the document -- volumes are edited numerically
  // in the inspector -- so a scale gizmo would be a lie.
  const mode = gizmo === "scale" ? "translate" : gizmo;
  return (
    <>
      <TransformControls
        object={object}
        mode={mode}
        showX={mode !== "rotate"}
        showZ={mode !== "rotate"}
        translationSnap={gridSnap > 0 ? gridSnap : null}
        rotationSnap={angleSnap > 0 ? angleSnap : null}
        size={0.7}
        onObjectChange={() => onChange(object)}
      />
      {/* Yaw ring while moving, matching props -- see the note there. */}
      {mode === "translate" && (
        <TransformControls
          object={object}
          mode="rotate"
          showX={false}
          showZ={false}
          rotationSnap={angleSnap > 0 ? angleSnap : null}
          size={1.15}
          onObjectChange={() => onChange(object)}
        />
      )}
    </>
  );
}

/**
 * Range circles declared by the catalog -- aggro, roam, and whatever comes
 * later.
 *
 * Drawn as an outline rather than a filled disc: these are often 10 m or more
 * across and overlap heavily in a populated map, so filling them would wash
 * out the ground underneath. The fill only appears on the selected element,
 * where reading the exact area matters.
 */
function Rings({ el, selected }: { el: MapElement; selected: boolean }) {
  const def = elementType(el.type);
  if (!def?.rings) return null;

  return (
    <>
      {def.rings.map((ring) => {
        const radius = paramNumber(el, ring.param);
        if (radius <= 0) return null;
        return (
          <group key={ring.param}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
              <ringGeometry args={[radius - 0.06, radius, 64]} />
              <meshBasicMaterial
                color={ring.color}
                transparent
                opacity={selected ? 0.95 : 0.5}
                depthWrite={false}
              />
            </mesh>
            {selected && (
              <>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                  <circleGeometry args={[radius, 64]} />
                  <meshBasicMaterial
                    color={ring.color}
                    transparent
                    opacity={0.08}
                    depthWrite={false}
                  />
                </mesh>
                {/* Captioned on the -Z edge so the two rings do not collide. */}
                <group position={[0, 0.4, -radius]}>
                  <Label text={`${ring.label} ${radius.toFixed(1)} m`} color={ring.color} />
                </group>
              </>
            )}
          </group>
        );
      })}
    </>
  );
}

const _down = new THREE.Vector3(0, -1, 0);
const _from = new THREE.Vector3();
const _ray = new THREE.Raycaster();

/**
 * Terrain height at a point, by dropping a ray onto the ground mesh.
 *
 * Sampling the surface rather than reading the height buffer keeps this
 * correct for all three ground kinds -- flat, painted and Blender mesh -- at
 * the cost of one raycast per gizmo frame, which is nothing next to the
 * dragging itself. Returns null when the ray misses, e.g. dragging an element
 * off the edge of the map, in which case the caller keeps the old height.
 */
function groundHeightAt(scene: THREE.Object3D, x: number, z: number): number | null {
  const ground = scene.getObjectByName(GROUND_NAME);
  if (!ground) return null;
  _from.set(x, 500, z);
  _ray.set(_from, _down);
  const hit = _ray.intersectObject(ground, true)[0];
  return hit && Number.isFinite(hit.point.y) ? hit.point.y : null;
}

function ElementView({
  el,
  selected,
  solo,
}: {
  el: MapElement;
  selected: boolean;
  /** Only selection there is, so it owns the gizmo. A group uses `GroupGizmo`. */
  solo: boolean;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const scene = useThree((s) => s.scene);
  const def = elementType(el.type);
  const color = elementColor(el);
  const facing = def?.facing ?? true;
  const r = COLLISION.playerRadius;
  // NPC feet are planted on local y=0; snap the anchor to terrain when we can
  // raycast it, otherwise keep the authored y from the map file.
  useSyncExternalStore(terrain.subscribe, () => terrain.heightVersion);
  const groundY = el.type === "npc" ? groundHeightAt(scene, el.x, el.z) : null;
  const y = el.type === "npc" ? (groundY ?? el.y ?? 0) : (el.y ?? 0);

  const commit = (o: THREE.Object3D) =>
    docStore.edit((d) => {
      const t = d.elements.find((x) => x.id === el.id);
      if (!t) return;
      t.x = o.position.x;
      t.z = o.position.z;
      t.yaw = o.rotation.y;
      // The gizmo only moves in XZ, so height has to be re-sampled rather than
      // read off the handle -- otherwise dragging an NPC onto a hill leaves it
      // buried at the height of wherever it started.
      t.y = groundHeightAt(scene, o.position.x, o.position.z) ?? t.y;
    }, `element:${el.id}`);

  // Where the label and the facing arrow sit, so a big capture circle does not
  // bury its own caption.
  const reach =
    el.shape?.kind === "circle"
      ? el.shape.radius
      : el.shape?.kind === "box"
        ? Math.max(el.shape.halfX, el.shape.halfZ)
        : r;

  return (
    <>
      <group
        ref={setGroup}
        position={[el.x, y, el.z]}
        rotation={[0, el.yaw, 0]}
        onPointerUp={(e) => {
          if (e.button !== 0 || wasDragged()) return;
          e.stopPropagation();
          selectEntity(el.id, {
            additive: e.shiftKey || e.ctrlKey || e.metaKey,
            isolate: e.altKey,
            tool: "select",
          });
        }}
      >
        {/* Trigger volume, when the type has one. */}
        {el.shape && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
            {el.shape.kind === "circle" ? (
              <circleGeometry args={[el.shape.radius, 40]} />
            ) : (
              <planeGeometry args={[el.shape.halfX * 2, el.shape.halfZ * 2]} />
            )}
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 0.3 : 0.16}
              depthWrite={false}
            />
          </mesh>
        )}

        <Rings el={el} selected={selected} />

        {/*
         * NPCs show their actual mesh. Suspended rather than blocking, so a
         * cold model load never stalls the rest of the map from drawing.
         */}
        {el.type === "npc" && (
          <Suspense fallback={null}>
            <NpcModel el={el} />
          </Suspense>
        )}

        {/* Body disc at the player's real collision radius. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <circleGeometry args={[r, 28]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.75 : 0.45}
            depthWrite={false}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[r - 0.05, r, 28]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
        </mesh>

        {/* Facing arrow, pointing down +X which is yaw 0. */}
        {facing && (
          <mesh position={[reach + 0.35, 0.07, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.16, 0.42, 3]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        )}

        {/*
         * Talk range. Drawn for NPCs in place of an authored volume, because
         * the reach is a constant rather than something you set per villager.
         */}
        {el.type === "npc" && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[NPC_INTERACT_RADIUS - 0.05, NPC_INTERACT_RADIUS, 48]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 0.9 : 0.35}
              depthWrite={false}
            />
          </mesh>
        )}

        {/*
         * Cylinder hint so the element is visible from a low camera. NPCs skip
         * it -- they have a body to be seen by, and the haze only fogs it.
         */}
        {el.type !== "npc" && (
        <mesh position={[0, 0.9, 0]}>
          <cylinderGeometry args={[r, r, 1.8, 16, 1, true]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.14}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        )}

        <group position={[0, 2.1, 0]}>
          <Label text={elementLabel(el)} color={color} />
        </group>
      </group>

      {solo && <Gizmo object={group} onChange={commit} />}
    </>
  );
}

export function Elements() {
  const { doc, selectedIds } = useEditor();
  const solo = selectedIds.length === 1 ? selectedIds[0] : null;
  return (
    <>
      {doc.elements.map((el) => (
        <ElementView
          key={el.id}
          el={el}
          selected={selectedIds.includes(el.id)}
          solo={el.id === solo}
        />
      ))}
    </>
  );
}
