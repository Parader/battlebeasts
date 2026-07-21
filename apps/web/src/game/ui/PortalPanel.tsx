import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";

type Props = {
    kind: "portal_pvp" | "portal_pve";
    onClose: () => void;
};

const PVP_MODES = [
    { id: "arena_2v2", label: "Arena 2v2" },
    { id: "arena_3v3", label: "Arena 3v3" },
    { id: "battleground", label: "Battleground" },
];

const PVE_OPTIONS = [
    { id: "dungeon", label: "Dungeon" },
    { id: "boss", label: "Boss" },
];

export function PortalPanel({ kind, onClose }: Props) {
    const [selected, setSelected] = useState<string[]>(kind === "portal_pvp" ? ["arena_2v2"] : ["dungeon"]);

    const title = kind === "portal_pvp" ? "PvP Portal" : "PvE / Coop Portal";
    const options = kind === "portal_pvp" ? PVP_MODES : PVE_OPTIONS;

    return (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-primary p-5 shadow-xl ring-1 ring-secondary">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-primary">{title}</h2>
                    <CloseButton onClick={onClose} />
                </div>

                <p className="mb-3 text-sm text-tertiary">
                    {kind === "portal_pvp"
                        ? "Choose which PvP modes to queue for."
                        : "Choose content type and modifiers (stubs)."}
                </p>

                <div className="space-y-2">
                    {options.map((opt) => (
                        <Checkbox
                            key={opt.id}
                            isSelected={selected.includes(opt.id)}
                            onChange={(isSelected) => {
                                setSelected((prev) =>
                                    isSelected ? [...prev.filter((x) => x !== opt.id), opt.id] : prev.filter((x) => x !== opt.id),
                                );
                            }}
                            label={opt.label}
                        />
                    ))}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button color="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        color="primary"
                        onClick={() => {
                            // Match transfer lands in a later step
                            onClose();
                        }}
                    >
                        {kind === "portal_pvp" ? "Queue" : "Enter"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
