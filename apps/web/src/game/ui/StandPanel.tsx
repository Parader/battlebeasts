import { useMemo, useState } from "react";
import { Room } from "colyseus.js";
import {
    ABILITIES,
    COSMETIC_COLORS,
    LOADOUT_SIZE,
    MAX_TALENTS,
    SHOP_ITEMS,
    SPELL_SLOTS,
    TALENTS,
    abilitiesForSlot,
    canAffordCoins,
    canEquipInSlot,
    formatShopCost,
    formatWallet,
    normalizeLoadout,
} from "@battlebeasts/shared";
import { Heading } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";

type Kind = "customization" | "build" | "talent" | "shop";

type Economy = {
    copper: number;
    silver: number;
    gold: number;
    essence: number;
    loadout: string[];
    talents: string[];
};

type Props = {
    kind: Kind;
    onClose: () => void;
    room: Room | null;
    economy: Economy;
};

const TITLES: Record<Kind, string> = {
    customization: "Customization",
    build: "Spells",
    talent: "Talents",
    shop: "Shop",
};

export function StandPanel({ kind, onClose, room, economy }: Props) {
    const [draftLoadout, setDraftLoadout] = useState(() => normalizeLoadout(economy.loadout));
    const [draftTalents, setDraftTalents] = useState(() => economy.talents);
    const [selectedSlot, setSelectedSlot] = useState(0);

    const selectedSlotDef = SPELL_SLOTS[selectedSlot];
    const slotPool = useMemo(
        () => (selectedSlotDef ? abilitiesForSlot(selectedSlotDef.id) : []),
        [selectedSlotDef],
    );

    const assignAbility = (abilityId: string) => {
        const slot = SPELL_SLOTS[selectedSlot];
        if (!slot || !canEquipInSlot(abilityId, slot.id)) return;
        setDraftLoadout((prev) => {
            const next = [...prev];
            next[selectedSlot] = abilityId;
            return normalizeLoadout(next);
        });
    };

    const toggleTalent = (id: string) => {
        setDraftTalents((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= MAX_TALENTS) return [...prev.slice(1), id];
            return [...prev, id];
        });
    };

    const loadoutReady =
        draftLoadout.length === LOADOUT_SIZE && new Set(draftLoadout).size === LOADOUT_SIZE;

    return (
        <ModalOverlay
            isOpen
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            isDismissable
        >
            <Modal className="w-full max-w-md">
                <Dialog>
                    <div className="w-full rounded-2xl bg-primary p-5 shadow-xl ring-1 ring-secondary">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <Heading slot="title" className="text-lg font-semibold text-primary">
                                    {TITLES[kind]}
                                </Heading>
                                <p className="text-xs text-tertiary">{formatWallet(economy)}</p>
                            </div>
                            <CloseButton onClick={onClose} />
                        </div>

                        {kind === "customization" && (
                            <div className="flex flex-wrap gap-2">
                                {COSMETIC_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className="size-10 rounded-full ring-2 ring-secondary"
                                        style={{ backgroundColor: color }}
                                        onClick={() => room?.send("set_color", { color })}
                                        aria-label={`Color ${color}`}
                                    />
                                ))}
                            </div>
                        )}

                        {kind === "build" && (
                            <div className="space-y-4">
                                <p className="text-sm text-tertiary">
                                    Each hotbar slot has its own spell pool. Pick one spell per slot —
                                    Q spells cannot go in R, and so on.
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {SPELL_SLOTS.map((slot, i) => {
                                        const id = draftLoadout[i];
                                        const ability = id ? ABILITIES[id] : undefined;
                                        const active = selectedSlot === i;
                                        return (
                                            <button
                                                key={slot.id}
                                                type="button"
                                                onClick={() => setSelectedSlot(i)}
                                                className={[
                                                    "flex min-w-[4.5rem] flex-col items-center rounded-lg px-2 py-1.5 text-center ring-1",
                                                    active
                                                        ? "bg-brand-solid/15 ring-brand-solid"
                                                        : "bg-secondary ring-secondary",
                                                ].join(" ")}
                                            >
                                                <span className="text-[10px] font-semibold uppercase text-tertiary">
                                                    {slot.label}
                                                </span>
                                                <span className="text-xs font-medium text-primary">
                                                    {ability?.name ?? "Empty"}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-tertiary">
                                    {selectedSlotDef?.label} pool — {selectedSlotDef?.hint} (
                                    {slotPool.length} available)
                                </p>
                                <ul className="max-h-56 space-y-1 overflow-y-auto">
                                    {slotPool.length === 0 ? (
                                        <li className="rounded-lg px-3 py-2 text-sm text-tertiary">
                                            No spells in this pool yet.
                                        </li>
                                    ) : (
                                        slotPool.map((a) => {
                                            const equipped = draftLoadout[selectedSlot] === a.id;
                                            return (
                                                <li key={a.id}>
                                                    <button
                                                        type="button"
                                                        onClick={() => assignAbility(a.id)}
                                                        className={[
                                                            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ring-1",
                                                            equipped
                                                                ? "bg-brand-solid/15 ring-brand-solid"
                                                                : "bg-secondary ring-transparent hover:ring-secondary",
                                                        ].join(" ")}
                                                    >
                                                        <span className="font-medium text-primary">{a.name}</span>
                                                        <span className="text-xs text-tertiary">
                                                            {a.shape} · {a.damage} dmg
                                                        </span>
                                                    </button>
                                                </li>
                                            );
                                        })
                                    )}
                                </ul>
                                <Button
                                    color="primary"
                                    isDisabled={!loadoutReady}
                                    onClick={() => room?.send("set_loadout", { abilityIds: draftLoadout })}
                                >
                                    Save loadout
                                </Button>
                            </div>
                        )}

                        {kind === "talent" && (
                            <div className="space-y-3">
                                <p className="text-sm text-tertiary">
                                    Up to {MAX_TALENTS} talents ({draftTalents.length}/{MAX_TALENTS})
                                </p>
                                <ul className="space-y-2">
                                    {Object.values(TALENTS).map((t) => (
                                        <li key={t.id}>
                                            <Checkbox
                                                isSelected={draftTalents.includes(t.id)}
                                                onChange={() => toggleTalent(t.id)}
                                                label={`${t.name} — ${t.description}`}
                                            />
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    color="primary"
                                    onClick={() => room?.send("set_talents", { talentIds: draftTalents })}
                                >
                                    Save talents
                                </Button>
                            </div>
                        )}

                        {kind === "shop" && (
                            <ul className="space-y-2">
                                {Object.values(SHOP_ITEMS).map((item) => {
                                    const canBuy =
                                        item.cost.kind === "coins"
                                            ? canAffordCoins(economy, item.cost.copper)
                                            : economy.essence >= item.cost.amount;
                                    return (
                                        <li
                                            key={item.id}
                                            className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2"
                                        >
                                            <span className="text-sm text-primary">{item.name}</span>
                                            <Button
                                                size="sm"
                                                color={canBuy ? "primary" : "secondary"}
                                                isDisabled={!canBuy}
                                                onClick={() => room?.send("shop_buy", { itemId: item.id })}
                                            >
                                                {formatShopCost(item.cost)}
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        <div className="mt-5 flex justify-end">
                            <Button color="secondary" onClick={onClose}>
                                Close
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
