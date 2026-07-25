import { useMemo, useState, type ReactNode } from "react";
import {
  PVE_CONTENTS,
  PVE_MODIFIERS,
  PVP_PORTAL_MODES,
  pvpModeCapacity,
  pvpModeFitsPlayerCount,
} from "@battlebeasts/shared";

type Props = {
  kind: "portal_pvp" | "portal_pve";
  onClose: () => void;
  /** Players currently in the hub room (capacity gate). */
  hubPlayerCount?: number;
  onConfirm: (
    portal: "pvp" | "pve",
    params: { modes?: string[]; content?: string; modifiers?: string[] },
  ) => void;
};

function BookShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className="bb-overlay-dim fixed inset-0 z-40 flex items-center justify-center p-4"
      data-ui-overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="bb-parchment bb-book-panel relative z-10 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mb-3 flex items-start justify-between gap-3">
          <h2 className="bb-title text-lg">{title}</h2>
          <button type="button" className="bb-btn-ink !px-2 !py-1 text-[10px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="bb-brass-rule mb-4" />
        {children}
        <div className="mt-5 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

export function PortalPanel({ kind, onClose, onConfirm, hubPlayerCount = 1 }: Props) {
  const enabledModes = useMemo(
    () => PVP_PORTAL_MODES.filter((m) => pvpModeFitsPlayerCount(m.id, hubPlayerCount)),
    [hubPlayerCount],
  );
  const [modes, setModes] = useState<string[]>(() =>
    enabledModes[0] ? [enabledModes[0].id] : ["arena_1v1"],
  );
  const [content, setContent] = useState("dungeon");
  const [modifiers, setModifiers] = useState<string[]>([]);

  const isPvp = kind === "portal_pvp";
  const title = isPvp ? "PvP Portal" : "PvE / Coop Portal";
  const canEnter = isPvp && modes.some((id) => pvpModeFitsPlayerCount(id, hubPlayerCount));

  return (
    <BookShell
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="bb-btn-ink" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="bb-btn-brass disabled:opacity-45"
            disabled={!canEnter || (isPvp && modes.length === 0)}
            title={isPvp ? undefined : "Still in development"}
            onClick={() =>
              onConfirm(isPvp ? "pvp" : "pve", isPvp ? { modes } : { content, modifiers })
            }
          >
            {isPvp ? "Open party lobby" : "Coming soon"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--bb-ink-soft)]">
        {isPvp
          ? "Pick the arena modes you want to queue for."
          : "This part is still in development."}
      </p>

      {isPvp ? (
        <div className="space-y-2">
          {PVP_PORTAL_MODES.map((opt) => {
            const fits = pvpModeFitsPlayerCount(opt.id, hubPlayerCount);
            const on = modes.includes(opt.id);
            const cap = pvpModeCapacity(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!fits}
                title={
                  fits
                    ? undefined
                    : `Need a larger mode (${hubPlayerCount} in room, max ${cap})`
                }
                className={[
                  "bb-choice",
                  on ? "bb-choice--on" : "",
                  !fits ? "opacity-40" : "",
                ].join(" ")}
                onClick={() => {
                  if (!fits) return;
                  setModes((prev) =>
                    prev.includes(opt.id)
                      ? prev.filter((x) => x !== opt.id)
                      : [...prev, opt.id],
                  );
                }}
              >
                <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                  {opt.label}
                </span>
                {!fits ? (
                  <span className="mt-0.5 block text-xs text-[var(--bb-ink-soft)]">
                    too small for this hub
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="bb-title text-xs">Content</p>
            {PVE_CONTENTS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled
                className={["bb-choice", content === opt.id ? "bb-choice--on" : "", "opacity-55"].join(
                  " ",
                )}
                onClick={() => setContent(opt.id)}
              >
                <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--bb-ink-soft)]">
                  Still in development
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="bb-title text-xs">Modifiers</p>
            {PVE_MODIFIERS.map((opt) => {
              const on = modifiers.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled
                  className={["bb-choice", on ? "bb-choice--on" : "", "opacity-55"].join(" ")}
                  onClick={() =>
                    setModifiers((prev) =>
                      prev.includes(opt.id)
                        ? prev.filter((x) => x !== opt.id)
                        : [...prev, opt.id],
                    )
                  }
                >
                  <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </BookShell>
  );
}
