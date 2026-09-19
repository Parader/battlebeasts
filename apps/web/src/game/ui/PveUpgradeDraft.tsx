import { useEffect, useState } from "react";
import {
  PVE_RARITY_COLOR,
  PVE_RARITY_LABEL,
  type PveUpgradeRarity,
} from "@battlebeasts/shared";

export type PveDraftOffer = {
  offerId: string;
  id: string;
  stat: string;
  rarity: string;
  magnitude: number;
  label: string;
  hint: string;
};

export type PveDraftWaiting = {
  sessionId: string;
  displayName: string;
  picked: boolean;
};

type Props = {
  wave: number;
  kills?: number;
  offers: PveDraftOffer[];
  waiting: PveDraftWaiting[];
  localSessionId: string | null;
  picked: boolean;
  canPick?: boolean;
  onPick: (offerId: string) => void;
};

/** Long enough to eat a combat click; short enough not to stall the draft. */
const SELECT_LOCK_MS = 800;
const CARD_STAGGER_MS = 90;

export function PveUpgradeDraft({
  wave,
  kills = 0,
  offers,
  waiting,
  localSessionId,
  picked,
  canPick = true,
  onPick,
}: Props) {
  const draftKey = offers.map((offer) => offer.offerId).join("|");
  const [selectable, setSelectable] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

  useEffect(() => {
    setSelectable(false);
    setSelectedOfferId(null);
    const id = window.setTimeout(() => setSelectable(true), SELECT_LOCK_MS);
    return () => window.clearTimeout(id);
  }, [draftKey]);

  const others = waiting.filter((w) => w.sessionId !== localSessionId);
  const localReady =
    selectedOfferId != null ||
    picked ||
    waiting.some((row) => row.sessionId === localSessionId && row.picked);

  const hint = !canPick
    ? others.length > 0
      ? "You're down — the living hunters are choosing."
      : "You're down — this draft will pass you by."
    : !selectable
      ? "Cards are appearing…"
      : localReady
        ? others.length > 0
          ? "Waiting for your party — click another card to change."
          : "Locked in."
        : others.length > 0
          ? "Pick one — you can change until everyone is ready."
          : "Pick one when you’re ready.";

  return (
    <div
      data-ui-overlay
      className="bb-pve-draft pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
    >
      <div className="bb-panel max-w-4xl px-5 py-4">
        <p
          className="text-center text-lg font-semibold text-[var(--bb-ink)]"
          style={{ fontFamily: "var(--bb-font-display)" }}
        >
          {kills > 0
            ? `${kills} slain — choose an upgrade`
            : `Wave ${wave} — choose an upgrade`}
        </p>
        <p className="mb-4 text-center text-xs text-[var(--bb-ink-soft)]">{hint}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {offers.map((offer, index) => {
            const rarity = (offer.rarity in PVE_RARITY_COLOR ? offer.rarity : "common") as PveUpgradeRarity;
            const color = PVE_RARITY_COLOR[rarity];
            const selected = selectedOfferId === offer.offerId;
            return (
              <button
                key={offer.offerId}
                type="button"
                disabled={!selectable || !canPick}
                onClick={() => {
                  if (!canPick || !selectable || selectedOfferId === offer.offerId) return;
                  setSelectedOfferId(offer.offerId);
                  onPick(offer.offerId);
                }}
                className={[
                  "bb-pve-draft-card bb-panel w-44 px-3 py-3 text-left transition hover:brightness-110 disabled:opacity-80",
                  selected ? "bb-pve-draft-card--selected" : "",
                ].join(" ")}
                style={{
                  boxShadow: selected
                    ? `inset 0 0 0 2px ${color}, 0 0 0 2px ${color}`
                    : `inset 0 0 0 2px ${color}`,
                  ["--bb-draft-delay" as string]: `${index * CARD_STAGGER_MS}ms`,
                }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
                  {PVE_RARITY_LABEL[rarity]}
                </span>
                <span className="mt-1 block text-sm font-semibold text-[var(--bb-ink)]">{offer.label}</span>
                <span className="mt-1 block text-xs text-[var(--bb-ink-soft)]">{offer.hint}</span>
                {selected ? (
                  <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-[var(--bb-brass)]">
                    Selected
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {others.length > 0 ? (
          <ul className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-[var(--bb-ink-soft)]">
            {others.map((row) => (
              <li key={row.sessionId}>
                {row.displayName}: {row.picked ? "ready" : "picking…"}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
