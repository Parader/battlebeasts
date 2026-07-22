import { useState } from "react";
import { PVE_CONTENTS, PVE_MODIFIERS, PVP_MODES } from "@battlebeasts/shared";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Heading } from "react-aria-components";

type Props = {
    kind: "portal_pvp" | "portal_pve";
    onClose: () => void;
    onConfirm: (portal: "pvp" | "pve", params: { modes?: string[]; content?: string; modifiers?: string[] }) => void;
};

export function PortalPanel({ kind, onClose, onConfirm }: Props) {
    const [modes, setModes] = useState<string[]>(["arena_2v2"]);
    const [content, setContent] = useState("dungeon");
    const [modifiers, setModifiers] = useState<string[]>([]);

    const isPvp = kind === "portal_pvp";
    const title = isPvp ? "PvP Portal" : "PvE / Coop Portal";

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
                            <Heading slot="title" className="text-lg font-semibold text-primary">
                                {title}
                            </Heading>
                            <CloseButton onClick={onClose} />
                        </div>

                        <p className="mb-3 text-sm text-tertiary">
                            {isPvp
                                ? "Select modes to queue for. Needs another hunter in queue — no solo matches."
                                : "Choose content and optional modifiers, then enter."}
                        </p>

                        {isPvp ? (
                            <div className="space-y-2">
                                {PVP_MODES.map((opt) => (
                                    <Checkbox
                                        key={opt.id}
                                        isSelected={modes.includes(opt.id)}
                                        onChange={(isSelected) => {
                                            setModes((prev) =>
                                                isSelected
                                                    ? [...prev.filter((x) => x !== opt.id), opt.id]
                                                    : prev.filter((x) => x !== opt.id),
                                            );
                                        }}
                                        label={opt.label}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    {PVE_CONTENTS.map((opt) => (
                                        <label
                                            key={opt.id}
                                            className="flex cursor-pointer items-start gap-3 rounded-lg bg-secondary px-3 py-2"
                                        >
                                            <input
                                                type="radio"
                                                name="pve-content"
                                                className="mt-1"
                                                checked={content === opt.id}
                                                onChange={() => setContent(opt.id)}
                                            />
                                            <span>
                                                <span className="block text-sm font-medium text-primary">{opt.label}</span>
                                                <span className="text-xs text-tertiary">{opt.description}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">
                                        Modifiers
                                    </p>
                                    {PVE_MODIFIERS.map((mod) => (
                                        <Checkbox
                                            key={mod.id}
                                            isSelected={modifiers.includes(mod.id)}
                                            onChange={(isSelected) => {
                                                setModifiers((prev) =>
                                                    isSelected
                                                        ? [...prev.filter((x) => x !== mod.id), mod.id]
                                                        : prev.filter((x) => x !== mod.id),
                                                );
                                            }}
                                            label={mod.label}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-5 flex justify-end gap-2">
                            <Button color="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                color="primary"
                                isDisabled={isPvp && modes.length === 0}
                                onClick={() => {
                                    if (isPvp) {
                                        onConfirm("pvp", { modes });
                                    } else {
                                        onConfirm("pve", { content, modifiers });
                                    }
                                }}
                            >
                                {isPvp ? "Queue" : "Enter"}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
