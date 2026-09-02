import { npcActionLabel, type NpcAction } from "@battlebeasts/shared";
import { useEffect } from "react";

/**
 * What an NPC says, and what you can do about it.
 *
 * Deliberately not a dialogue tree. A shopkeeper needs a line and a way into
 * the shop; a quest giver needs a line and a way into the quest log. Branching
 * conversation is a different feature with its own authoring problem, and
 * building the tree first would have meant designing an editor for it before
 * knowing whether any NPC wanted one.
 */

export type NpcDialogueData = {
  npcId: string;
  name: string;
  line: string;
  action: NpcAction;
};

export function NpcDialogue({
  npc,
  onAction,
  onClose,
}: {
  npc: NpcDialogueData;
  /** Open the panel this NPC hands off to. Never called for `talk`. */
  onAction: (action: Exclude<NpcAction, "talk">) => void;
  onClose: () => void;
}) {
  // Escape closes, matching every other panel in the game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const actionLabel = npcActionLabel(npc.action);

  return (
    <div className="bb-npc-dialogue" role="dialog" aria-label={`Talking to ${npc.name}`}>
      <p className="bb-npc-dialogue__name">{npc.name}</p>
      <p className="bb-npc-dialogue__line">{npc.line}</p>
      <div className="bb-npc-dialogue__actions">
        {actionLabel && (
          <button
            type="button"
            className="bb-npc-dialogue__button bb-npc-dialogue__button--primary"
            onClick={() => onAction(npc.action as Exclude<NpcAction, "talk">)}
          >
            {actionLabel}
          </button>
        )}
        <button type="button" className="bb-npc-dialogue__button" onClick={onClose}>
          Leave
        </button>
      </div>
    </div>
  );
}
