import { useEffect, useState } from "react";
import { Html } from "@react-three/drei";
import { getInteractPrompt, subscribeInteractPrompt } from "./interactPromptRuntime";

type Props = {
  /** Height above the character root. */
  y?: number;
};

/** Camera-projected "Press Space" prompt above the local player. */
export function InteractPromptBillboard({ y = 2.55 }: Props) {
  const [label, setLabel] = useState(() => getInteractPrompt()?.label ?? null);

  useEffect(() => {
    return subscribeInteractPrompt(() => {
      setLabel(getInteractPrompt()?.label ?? null);
    });
  }, []);

  if (!label) return null;

  return (
    <Html
      position={[0, y, 0]}
      center
      style={{ pointerEvents: "none" }}
      zIndexRange={[40, 0]}
    >
      <div className="bb-interact-prompt">
        <p className="bb-interact-prompt__label">{label}</p>
        <p className="bb-interact-prompt__key">Press Space</p>
      </div>
    </Html>
  );
}
