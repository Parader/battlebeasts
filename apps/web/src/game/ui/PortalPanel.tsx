import { useState, type ReactNode } from "react";
import { PVE_CONTENTS, PVE_MODIFIERS, PVP_MODES } from "@battlebeasts/shared";

type Props = {
  kind: "portal_pvp" | "portal_pve";
  onClose: () => void;
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

export function PortalPanel({ kind, onClose, onConfirm }: Props) {
  const [modes, setModes] = useState<string[]>(["arena_2v2"]);
  const [content, setContent] = useState("dungeon");
  const [modifiers, setModifiers] = useState<string[]>([]);

  const isPvp = kind === "portal_pvp";
  const title = isPvp ? "PvP Portal" : "PvE / Coop Portal";

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
            className="bb-btn-brass"
            onClick={() =>
              onConfirm(isPvp ? "pvp" : "pve", isPvp ? { modes } : { content, modifiers })
            }
          >
            Enter
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--bb-ink-soft)]">
        {isPvp
          ? "Select modes to queue for. Needs another hunter in queue — no solo matches."
          : "Choose content and optional modifiers, then enter."}
      </p>

      {isPvp ? (
        <div className="space-y-2">
          {PVP_MODES.map((opt) => {
            const on = modes.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                className={["bb-choice", on ? "bb-choice--on" : ""].join(" ")}
                onClick={() =>
                  setModes((prev) =>
                    prev.includes(opt.id)
                      ? prev.filter((x) => x !== opt.id)
                      : [...prev, opt.id],
                  )
                }
              >
                <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--bb-ink-soft)]">{opt.description}</span>
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
                className={["bb-choice", content === opt.id ? "bb-choice--on" : ""].join(" ")}
                onClick={() => setContent(opt.id)}
              >
                <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--bb-ink-soft)]">{opt.description}</span>
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
                  className={["bb-choice", on ? "bb-choice--on" : ""].join(" ")}
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
                  <span className="mt-0.5 block text-xs text-[var(--bb-ink-soft)]">
                    {opt.description}
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
