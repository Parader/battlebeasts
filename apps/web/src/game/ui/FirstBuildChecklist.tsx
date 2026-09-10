import { SPELL_SLOTS, isLoadoutReady } from "@battlebeasts/shared";
import { useEffect } from "react";
import { setFirstBuildGuide } from "../firstBuildGuideRuntime";

type Props = {
  loadout: string[];
  hasTutorialChest: boolean;
  onOpenQuests: () => void;
};

/** Hub checklist until the first seven-spell kit is chosen and the tutorial chest is looted. */
export function FirstBuildChecklist({
  loadout,
  hasTutorialChest,
  onOpenQuests,
}: Props) {
  const ready = isLoadoutReady(loadout);
  const filled = loadout.filter(Boolean).length;

  useEffect(() => {
    setFirstBuildGuide(ready ? null : "build");
    return () => setFirstBuildGuide(null);
  }, [ready]);

  if (ready && !hasTutorialChest) return null;

  return (
    <div
      data-ui-overlay
      className="pointer-events-auto absolute inset-x-0 top-24 z-30 flex justify-center px-3"
    >
      <div className="bb-parchment max-w-md px-5 py-3 text-center">
        <p className="bb-section-label mb-1">First build</p>
        <p
          className="text-base text-[var(--bb-ink)]"
          style={{ fontFamily: "var(--bb-font-display)" }}
        >
          {ready
            ? "Loot your tutorial chest, then buy talent points at the tree."
            : `Walk to the Spell Armoury (blue beacon) and press Space. Pick a spell for every key (${filled}/${SPELL_SLOTS.length}). Flex can wait.`}
        </p>
        {ready ? (
          <div className="mt-2.5 flex justify-center gap-2">
            <button type="button" className="bb-btn-brass" onClick={onOpenQuests}>
              Open Quests
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
