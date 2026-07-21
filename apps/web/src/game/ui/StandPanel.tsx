import { Room } from "colyseus.js";
import { ABILITIES, COSMETIC_COLORS, DEFAULT_LOADOUT, SHOP_ITEMS, TALENTS } from "@battlebeasts/shared";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";

type Kind = "customization" | "build" | "talent" | "shop";

type Props = {
    kind: Kind;
    onClose: () => void;
    room: Room | null;
};

const TITLES: Record<Kind, string> = {
    customization: "Customization",
    build: "Build",
    talent: "Talents",
    shop: "Shop",
};

export function StandPanel({ kind, onClose, room }: Props) {
    return (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-primary p-5 shadow-xl ring-1 ring-secondary">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-primary">{TITLES[kind]}</h2>
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
                    <ul className="space-y-2">
                        {DEFAULT_LOADOUT.map((id) => {
                            const a = ABILITIES[id];
                            return (
                                <li key={id} className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary">
                                    <span className="font-medium text-primary">{a.name}</span> — {a.shape}, {a.damage} dmg
                                </li>
                            );
                        })}
                        <p className="text-xs text-tertiary">Spell picker UI expands later; kit is data-driven.</p>
                    </ul>
                )}

                {kind === "talent" && (
                    <ul className="space-y-2">
                        {Object.values(TALENTS).map((t) => (
                            <li key={t.id} className="rounded-lg bg-secondary px-3 py-2 text-sm">
                                <span className="font-medium text-primary">{t.name}</span>
                                <span className="text-tertiary"> — {t.description}</span>
                            </li>
                        ))}
                    </ul>
                )}

                {kind === "shop" && (
                    <ul className="space-y-2">
                        {Object.values(SHOP_ITEMS).map((item) => (
                            <li key={item.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                                <span className="text-sm text-primary">{item.name}</span>
                                <Button size="sm" color="secondary" isDisabled>
                                    {item.cost.amount} {item.cost.resourceId}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="mt-5 flex justify-end">
                    <Button color="primary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
}
