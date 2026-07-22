import { useMemo, useState } from "react";
import { Room } from "colyseus.js";
import {
    ABILITIES,
    COSMETIC_COLORS,
    LOADOUT_SIZE,
    MAX_TALENTS,
    SHOP_ITEMS,
    TALENTS,
    canAffordCoins,
    formatShopCost,
    formatWallet,
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
    build: "Build",
    talent: "Talents",
    shop: "Shop",
};

export function StandPanel({ kind, onClose, room, economy }: Props) {
    const [draftLoadout, setDraftLoadout] = useState(() =>
        economy.loadout.length === LOADOUT_SIZE ? economy.loadout : Object.keys(ABILITIES).slice(0, LOADOUT_SIZE),
    );
    const [draftTalents, setDraftTalents] = useState(() => economy.talents);

    const abilityList = useMemo(() => Object.values(ABILITIES), []);

    const toggleAbility = (id: string) => {
        setDraftLoadout((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= LOADOUT_SIZE) return [...prev.slice(1), id];
            return [...prev, id];
        });
    };

    const toggleTalent = (id: string) => {
        setDraftTalents((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= MAX_TALENTS) return [...prev.slice(1), id];
            return [...prev, id];
        });
    };

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
                            <div className="space-y-3">
                                <p className="text-sm text-tertiary">
                                    Pick {LOADOUT_SIZE} abilities ({draftLoadout.length}/{LOADOUT_SIZE})
                                </p>
                                <ul className="space-y-2">
                                    {abilityList.map((a) => (
                                        <li key={a.id}>
                                            <Checkbox
                                                isSelected={draftLoadout.includes(a.id)}
                                                onChange={() => toggleAbility(a.id)}
                                                label={`${a.name} — ${a.shape}, ${a.damage} dmg`}
                                            />
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    color="primary"
                                    isDisabled={draftLoadout.length !== LOADOUT_SIZE}
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
