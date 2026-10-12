import { lightPreset, paramNumber, paramString, type MapDoc, type MapElement } from "@battlebeasts/shared";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";

/** Point lights authored on the map. The lamp post is a prop; this is its light. */
export function MapLights({ doc }: { doc: MapDoc }) {
  const lights = doc.elements.filter((element) => element.type === "light");
  if (!lights.length) return null;
  return (
    <>
      {lights.map((element) => (
        <PlacedLight key={element.id} el={element} />
      ))}
    </>
  );
}

function PlacedLight({ el }: { el: MapElement }) {
  const preset = lightPreset(paramString(el, "kind", "lamp"));
  const height = Math.max(0, paramNumber(el, "height", preset.height));
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const lamp = light.current;
    if (!lamp || preset.flicker === 0) return;
    const wave = Math.sin(performance.now() / 1000 * preset.flickerSpeed);
    lamp.intensity = preset.intensity * (1 + wave * preset.flicker);
  });
  return (
    <pointLight
      ref={light}
      position={[el.x, (el.y ?? 0) + height, el.z]}
      color={preset.color}
      intensity={preset.intensity}
      distance={preset.distance}
      decay={2}
    />
  );
}
