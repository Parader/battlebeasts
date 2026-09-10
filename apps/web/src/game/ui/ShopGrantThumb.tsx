import {
  COSMETIC_SLOT_LABELS,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  cosmeticAuraColorName,
  cosmeticColorName,
  getCosmeticItem,
  getEmote,
  hideTintSwatchStyle,
  type ChestUnlockGrant,
  type ShopItemDef,
} from "@battlebeasts/shared";
import { AuraSwatch } from "./AuraSwatch";
import { GameIcon } from "./GameIcon";
import { GEAR_SLOT_ICONS, type GameIconId } from "./gameIcons";

type GrantThumbSource = ChestUnlockGrant | ShopItemDef["grant"];

/** Same thumb language as the Merchant shop item cards. */
export function ShopGrantThumb({
  grant,
  /** Prefer showing slot/emote icons when shop list would omit them. */
  forceIcon = false,
}: {
  grant: GrantThumbSource;
  forceIcon?: boolean;
}) {
  if (grant.kind === "color" || grant.kind === "pattern_color") {
    return (
      <span
        className="bb-shop__thumb"
        style={grant.kind === "color" ? hideTintSwatchStyle(grant.hex) : { backgroundColor: grant.hex }}
        aria-hidden
      />
    );
  }
  if (grant.kind === "pattern") {
    return (
      <span className="bb-shop__thumb bb-shop__thumb--pattern" aria-hidden>
        <AuraSwatch auraId={grant.patternId} auraColor={DEFAULT_COSMETIC_PATTERN_COLOR} />
      </span>
    );
  }
  if (grant.kind === "cosmetic") {
    if (!forceIcon) return null;
    const def = getCosmeticItem(grant.itemId);
    const slot = def?.slot;
    const iconId: GameIconId = slot ? GEAR_SLOT_ICONS[slot] : "chest-armor";
    return (
      <span className="bb-shop__thumb bb-shop__thumb--icon" aria-hidden title={def?.name}>
        <GameIcon id={iconId} size={22} gray={0.9} />
      </span>
    );
  }
  if (grant.kind === "emote") {
    if (!forceIcon) return null;
    return (
      <span className="bb-shop__thumb bb-shop__thumb--icon" aria-hidden>
        <GameIcon id="drama-masks" size={22} gray={0.9} />
      </span>
    );
  }
  if (grant.kind === "flex_slot") {
    return (
      <span className="bb-shop__thumb bb-shop__thumb--icon" aria-hidden>
        <GameIcon id="skills" size={22} gray={0.82} />
      </span>
    );
  }
  if (grant.kind === "loadout_slot") {
    return (
      <span className="bb-shop__thumb bb-shop__thumb--icon" aria-hidden>
        <GameIcon id="skills" size={22} gray={0.82} />
      </span>
    );
  }
  if (grant.kind === "consumable") {
    const iconId: GameIconId =
      grant.effect === "copper_pouch" ? "shiny-purse" : "health-potion";
    return (
      <span className="bb-shop__thumb bb-shop__thumb--icon" aria-hidden>
        <GameIcon id={iconId} size={22} gray={0.82} />
      </span>
    );
  }
  return <span className="bb-shop__thumb bb-shop__thumb--empty" aria-hidden />;
}

export function ShopItemThumb({ item }: { item: ShopItemDef }) {
  return <ShopGrantThumb grant={item.grant} />;
}

/** Label for chest unlock / duplicate lines. */
export function grantDisplayLabel(grant: ChestUnlockGrant, fallback: string): string {
  switch (grant.kind) {
    case "color":
      return cosmeticColorName(grant.hex);
    case "pattern_color":
      return `${cosmeticAuraColorName(grant.hex)} Ink`;
    case "pattern":
      return fallback;
    case "cosmetic": {
      const def = getCosmeticItem(grant.itemId);
      if (!def) return fallback;
      return `${def.name} (${COSMETIC_SLOT_LABELS[def.slot]})`;
    }
    case "emote": {
      const emote = getEmote(grant.emoteId);
      return emote?.name ?? fallback;
    }
  }
}
