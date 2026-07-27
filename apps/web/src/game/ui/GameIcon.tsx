import type { CSSProperties } from "react";
import { assetUrl } from "../assetUrl";
import type { GameIconId } from "./gameIcons";

type Props = {
  id: GameIconId;
  size?: number;
  /** Soften pure white for dark UI (0–1). Default ~0.78. */
  gray?: number;
  className?: string;
  title?: string;
};

/**
 * White game-icons.net SVG, slightly grayed for dark panels.
 * Files live in public/icons/game/{id}.svg
 */
export function GameIcon({ id, size = 22, gray = 0.78, className, title }: Props) {
  const style: CSSProperties = {
    width: size,
    height: size,
    opacity: Math.max(0.35, Math.min(1, gray)),
  };

  return (
    <img
      src={assetUrl(`icons/game/${id}.svg`)}
      alt=""
      title={title}
      width={size}
      height={size}
      draggable={false}
      className={["bb-game-icon", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden={title ? undefined : true}
    />
  );
}
