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
  offers: PveDraftOffer[];
  waiting: PveDraftWaiting[];
  localSessionId: string | null;
  picked: boolean;
  onPick: (offerId: string) => void;
};

export function PveUpgradeDraft({
  wave,
  offers,
  waiting,
  localSessionId,
  picked,
  onPick,
}: Props) {
  const others = waiting.filter((w) => w.sessionId !== localSessionId);
  return (
    <div
      data-ui-overlay
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
    >
      <div className="bb-panel max-w-4xl px-5 py-4">
        <p
          className="text-center text-lg font-semibold text-[var(--bb-ink)]"
          style={{ fontFamily: "var(--bb-font-display)" }}
        >
          Wave {wave} — choose an upgrade
        </p>
        <p className="mb-4 text-center text-xs text-[var(--bb-ink-soft)]">
          {picked ? "Waiting for your party…" : "The hunt pauses until everyone picks."}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {offers.map((offer) => {
            const rarity = (offer.rarity in PVE_RARITY_COLOR ? offer.rarity : "common") as PveUpgradeRarity;
            const color = PVE_RARITY_COLOR[rarity];
            return (
              <button
                key={offer.offerId}
                type="button"
                disabled={picked}
                onClick={() => onPick(offer.offerId)}
                className="bb-panel w-44 px-3 py-3 text-left transition hover:brightness-110 disabled:opacity-60"
                style={{ boxShadow: `inset 0 0 0 2px ${color}` }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
                  {PVE_RARITY_LABEL[rarity]}
                </span>
                <span className="mt-1 block text-sm font-semibold text-[var(--bb-ink)]">{offer.label}</span>
                <span className="mt-1 block text-xs text-[var(--bb-ink-soft)]">{offer.hint}</span>
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
