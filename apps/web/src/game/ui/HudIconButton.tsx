import type { ReactNode } from "react";
import { GameIcon } from "./GameIcon";
import type { GameIconId } from "./gameIcons";

type Props = {
  label: string;
  icon: GameIconId;
  onClick?: () => void;
  href?: string;
  badge?: number | string | null;
  /** Brass fill for primary actions (party / return). */
  accent?: boolean;
  active?: boolean;
};

/** Compact circular HUD action — label appears on hover. */
export function HudIconButton({
  label,
  icon,
  onClick,
  href,
  badge,
  accent,
  active,
}: Props) {
  const className = [
    "bb-hud-icon-btn",
    accent ? "bb-hud-icon-btn--accent" : "",
    active ? "bb-hud-icon-btn--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner: ReactNode = (
    <>
      <GameIcon id={icon} size={18} gray={0.95} />
      <span className="bb-hud-icon-btn__tip">{label}</span>
      {badge != null && badge !== 0 && badge !== "" ? (
        <span className="bb-notify-badge" aria-label={`${label} alert`}>
          {badge}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className={`${className} no-underline`} aria-label={label} title={label}>
        {inner}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick} aria-label={label} title={label}>
      {inner}
    </button>
  );
}
