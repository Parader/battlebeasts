import { useMemo } from "react";
import { filterQuestRowsForDisplay } from "@battlebeasts/shared";
import { GamePanelShell } from "./GamePanelShell";
import { GameIcon } from "./GameIcon";

export type HubQuestRow = {
  id: string;
  label: string;
  type: string;
  target: number;
  chest: string;
  progress: number;
  completed: boolean;
};

export type HubChestRow = {
  id: string;
  quality: string;
  source: string;
  created_at?: string;
};

/** Short label for chest.origin (quest / ranked / admin). */
function formatChestSource(source: string): string {
  if (source.startsWith("quest:")) {
    const questId = source.slice("quest:".length).split(":")[0] ?? source;
    return `Quest · ${questId.replace(/_/g, " ")}`;
  }
  if (source.startsWith("ranked_season:")) {
    const key = source.split(":").pop() ?? "ranked";
    return `Ranked · ${key.replace(/_/g, " ")}`;
  }
  if (source.startsWith("admin:")) return "Admin";
  return source;
}

type Props = {
  open: boolean;
  onClose: () => void;
  quests: HubQuestRow[];
  chests: HubChestRow[];
  onOpenChest: (chestId: string) => void;
  pendingChestOpenId?: string | null;
};

/** Hub quests + closed chests (mystery until open). */
export function QuestsPanel({
  open,
  onClose,
  quests,
  chests,
  onOpenChest,
  pendingChestOpenId = null,
}: Props) {
  const visible = useMemo(() => filterQuestRowsForDisplay(quests), [quests]);
  const daily = visible.filter((q) => q.type === "daily");
  const season = visible.filter((q) => q.type === "season");
  const lifetime = visible.filter((q) => q.type === "lifetime");

  if (!open) return null;

  return (
    <GamePanelShell
      title="Quests & chests"
      subtitle="Daily goals and account milestones"
      onClose={onClose}
      maxHeightClass="max-h-[min(80dvh,640px)]"
    >
      <section className="mb-5 space-y-2">
        <h3 className="bb-section-label">Chests</h3>
        {chests.length === 0 ? (
          <p className="bb-muted text-sm">No closed chests yet. Complete quests to earn them.</p>
        ) : (
          <ul className="space-y-2">
            {chests.map((c) => (
              <li key={c.id} className="bb-list-row flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col gap-0.5 text-sm text-[var(--bb-ink)]">
                  <span className="flex items-center gap-2">
                    <GameIcon id="locked-chest" size={22} gray={0.9} title="Chest" />
                    Chest
                  </span>
                  {c.source ? (
                    <span className="bb-meta truncate pl-7" title={c.source}>
                      {formatChestSource(c.source)}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="bb-btn-brass disabled:opacity-40"
                  disabled={Boolean(pendingChestOpenId)}
                  onClick={() => onOpenChest(c.id)}
                >
                  {pendingChestOpenId === c.id ? "Opening…" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5 space-y-2">
        <h3 className="bb-section-label">Daily</h3>
        {daily.map((q) => (
          <div key={q.id} className="bb-list-row bb-list-row--stack">
            <p className="text-sm text-[var(--bb-ink)]">{q.label}</p>
            <p className="bb-meta flex items-center gap-1.5 tabular-nums">
              <span>
                {Math.min(q.progress, q.target)}/{q.target}
                {q.completed ? " · done" : ""}
              </span>
              <span className="inline-flex items-center gap-1" title="Chest reward">
                · <GameIcon id="locked-chest" size={14} gray={0.85} />
              </span>
            </p>
          </div>
        ))}
      </section>

      {season.length > 0 ? (
        <section className="mb-5 space-y-2">
          <h3 className="bb-section-label">Season</h3>
          {season.map((q) => (
            <div key={q.id} className="bb-list-row bb-list-row--stack">
              <p className="text-sm text-[var(--bb-ink)]">{q.label}</p>
              <p className="bb-meta flex items-center gap-1.5 tabular-nums">
                <span>
                  {Math.min(q.progress, q.target)}/{q.target}
                  {q.completed ? " · done" : ""}
                </span>
                <span className="inline-flex items-center gap-1" title="Chest reward">
                  · <GameIcon id="locked-chest" size={14} gray={0.85} />
                </span>
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="bb-section-label">Lifetime</h3>
        {lifetime.map((q) => (
          <div key={q.id} className="bb-list-row bb-list-row--stack">
            <p className="text-sm text-[var(--bb-ink)]">{q.label}</p>
            <p className="bb-meta flex items-center gap-1.5 tabular-nums">
              <span>
                {Math.min(q.progress, q.target)}/{q.target}
                {q.completed ? " · done" : ""}
              </span>
              <span className="inline-flex items-center gap-1" title="Chest reward">
                · <GameIcon id="locked-chest" size={14} gray={0.85} />
              </span>
            </p>
          </div>
        ))}
      </section>
    </GamePanelShell>
  );
}
