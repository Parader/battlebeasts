import {
  COSMETIC_SLOTS,
  cosmeticsEquippedFromFields,
  normalizeCosmeticsEquipped,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";

type SlotFields = {
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
};

/** Read equipped cosmetics from a Colyseus player schema-like object. */
export function equippedFromPlayer(player: SlotFields | null | undefined): CosmeticsEquipped {
  return cosmeticsEquippedFromFields(player ?? {});
}

export function cosmeticsKey(equipped: CosmeticsEquipped | SlotFields | null | undefined): string {
  let eq: CosmeticsEquipped;
  if (equipped && typeof equipped === "object" && "cosmeticHat" in equipped) {
    eq = cosmeticsEquippedFromFields(equipped as SlotFields);
  } else {
    eq = normalizeCosmeticsEquipped(equipped);
  }
  return COSMETIC_SLOTS.map((s) => eq[s] ?? "").join("|");
}
