import type { ReactNode } from "react";
import {
  copperToCoins,
  normalizeCoins,
  type CoinPurse,
  type ShopCost,
  type Wallet,
} from "@battlebeasts/shared";
import { assetUrl } from "../assetUrl";

export type CoinMetal = "copper" | "silver" | "gold";
export type GemKind = "essence" | "ruby";

const COIN_FILL: Record<CoinMetal, string> = {
  copper: "#c87941",
  silver: "#d0d5db",
  gold: "#e4bc4a",
};

const COIN_RIM: Record<CoinMetal, string> = {
  copper: "#8a4f24",
  silver: "#8a929c",
  gold: "#b4861c",
};

const GEM_COLOR: Record<GemKind, string> = {
  essence: "#4da3ff",
  ruby: "#e4455a",
};

const GEM_ICON: Record<GemKind, string> = {
  essence: "blue-gem",
  ruby: "red-gem",
};

/** Tiny metal coin glyph — tinted copper / silver / gold. */
export function CoinIcon({
  metal,
  size = 12,
  className,
}: {
  metal: CoinMetal;
  size?: number;
  className?: string;
}) {
  const fill = COIN_FILL[metal];
  const rim = COIN_RIM[metal];
  return (
    <svg
      className={["bb-coin-icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
    >
      <circle cx="8" cy="8" r="7" fill={fill} stroke={rim} strokeWidth="1.2" />
      <circle
        cx="8"
        cy="8"
        r="4.6"
        fill="none"
        stroke={rim}
        strokeWidth="0.7"
        opacity="0.55"
      />
      <ellipse cx="6.1" cy="5.4" rx="2.1" ry="1.15" fill="#fff" opacity="0.32" />
    </svg>
  );
}

/** Blue essence / red ruby gem (masked white SVG). */
export function GemIcon({
  kind,
  size = 14,
  className,
  title,
}: {
  kind: GemKind;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={["bb-gem-icon", `bb-gem-icon--${kind}`, className].filter(Boolean).join(" ")}
      title={title ?? kind}
      aria-hidden={title ? undefined : true}
      style={{
        width: size,
        height: size,
        backgroundColor: GEM_COLOR[kind],
        WebkitMaskImage: `url(${assetUrl(`icons/game/${GEM_ICON[kind]}.svg`)})`,
        maskImage: `url(${assetUrl(`icons/game/${GEM_ICON[kind]}.svg`)})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

function CoinStack({
  metal,
  amount,
  force,
}: {
  metal: CoinMetal;
  amount: number;
  /** Always render, even at 0 (used when purse is empty so copper shows). */
  force?: boolean;
}) {
  if (!force && amount <= 0) return null;
  return (
    <span className={`bb-coin bb-coin--${metal}`} title={metal}>
      <CoinIcon metal={metal} size={11} />
      <span className="bb-coin__amt">{amount}</span>
    </span>
  );
}

/** Copper / silver / gold with colored coin pictograms. */
export function CoinsDisplay({
  purse,
  className,
}: {
  purse: CoinPurse;
  className?: string;
}) {
  const n = normalizeCoins(purse);
  const anyMetal = n.gold > 0 || n.silver > 0 || n.copper > 0;
  return (
    <span className={["bb-coins", className].filter(Boolean).join(" ")}>
      <CoinStack metal="gold" amount={n.gold} />
      <CoinStack metal="silver" amount={n.silver} />
      <CoinStack metal="copper" amount={n.copper} force={!anyMetal} />
    </span>
  );
}

/** Full wallet row: metals + essence + rubies. */
export function WalletDisplay({
  wallet,
  className,
  /** Neutral beige amounts (HUD) — coin/gem icons stay tinted. */
  neutralText = false,
}: {
  wallet: Pick<Wallet, "copper" | "silver" | "gold" | "essence" | "rubies">;
  className?: string;
  neutralText?: boolean;
}) {
  const rubies = wallet.rubies ?? 0;
  return (
    <span
      className={[
        "bb-wallet",
        neutralText ? "bb-wallet--neutral" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <CoinsDisplay purse={wallet} />
      <span className="bb-wallet__sep" aria-hidden>
        ·
      </span>
      <span className="bb-gem-stack" title="essence">
        <GemIcon kind="essence" size={13} />
        <span className="bb-wallet__soft">{wallet.essence}</span>
      </span>
      <span className="bb-wallet__sep" aria-hidden>
        ·
      </span>
      <span className="bb-gem-stack" title="rubies">
        <GemIcon kind="ruby" size={13} />
        <span className="bb-wallet__soft">{rubies}</span>
      </span>
    </span>
  );
}

/** Shop price — coins as pictograms, essence/rubies as gems. */
export function ShopCostDisplay({ cost }: { cost: ShopCost }): ReactNode {
  if (cost.kind === "essence") {
    return (
      <span className="bb-gem-stack">
        <GemIcon kind="essence" size={14} />
        <span>{cost.amount}</span>
      </span>
    );
  }
  if (cost.kind === "rubies") {
    return (
      <span className="bb-gem-stack">
        <GemIcon kind="ruby" size={14} />
        <span>{cost.amount}</span>
      </span>
    );
  }
  return <CoinsDisplay purse={copperToCoins(cost.copper)} />;
}
