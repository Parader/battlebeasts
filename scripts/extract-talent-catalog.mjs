/**
 * One-off helper: dump talent catalog summary as JSON for docs.
 * Usage: node scripts/extract-talent-catalog.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "packages/shared/src/talentCatalog.ts"), "utf8");

const blocks = [...src.matchAll(/"([A-Z]{3}_[0-9]{2})":\s*\{([\s\S]*?)\n  \},/g)];

const talents = blocks.map(([, id, body]) => {
  const pick = (key) => {
    const m = body.match(new RegExp(`${key}:\\s*([^,\\n]+)`));
    return m ? m[1].trim().replace(/^"|"$/g, "") : undefined;
  };
  const pickStr = (key) => {
    const m = body.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    return m ? m[1] : undefined;
  };
  const pickMultiline = (key) => {
    const m = body.match(new RegExp(`${key}:\\s*\\n\\s*"([^"]*)"`));
    return m ? m[1] : pickStr(key);
  };
  return {
    id,
    tree: pickStr("tree"),
    tier: Number(pick("tier")),
    name: pickStr("name"),
    pointCost: Number(pick("pointCost")),
    maxRank: pick("maxRank") ? Number(pick("maxRank")) : undefined,
    layoutOrder: pick("layoutOrder") ? Number(pick("layoutOrder")) : undefined,
    requiredPoints: Number(pick("requiredPoints")),
    implemented: /implemented:\s*true/.test(body),
    hidden: /hidden:\s*true/.test(body),
    requires: [...body.matchAll(/requires:\s*\[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    ),
    affectedTags: [...body.matchAll(/"([A-Za-z]+)"/g)]
      .map((m) => m[1])
      .filter((t) =>
        [
          "Damage",
          "Defense",
          "Healing",
          "Movement",
          "CrowdControl",
          "Slow",
          "Area",
          "Nova",
          "Cone",
          "Explosion",
          "DamageOverTime",
          "SingleTarget",
          "MultiHit",
          "Cast",
          "Barrier",
          "Summon",
          "Obstacle",
          "Shield",
          "Ally",
          "Stun",
          "Root",
          "Silence",
          "Fear",
          "Reveal",
          "GroundEffect",
          "Cooldown",
          "Debuff",
          "Buff",
          "Self",
          "Channel",
          "Instant",
          "Utility",
          "Stealth",
          "Counter",
          "Reflect",
          "Pierce",
          "Homing",
          "Chain",
          "Trap",
          "Persistent",
          "Cleanse",
          "Purge",
          "Interrupt",
          "Resource",
          "SpellSlot",
          "Dash",
          "Blink",
          "Melee",
          "Line",
          "Knockback",
          "Pull",
          "Knockup",
          "Haste",
          "Defensive",
          "Wall",
          "Combo",
          "HealOverTime",
          "Control",
        ].includes(t),
      ),
    exactEffect: pickMultiline("exactEffect"),
    balanceNote: pickStr("balanceNote"),
  };
});

const visible = talents.filter((t) => !t.hidden);
const implemented = visible.filter((t) => t.implemented);

console.log(
  JSON.stringify(
    {
      total: talents.length,
      visible: visible.length,
      hidden: talents.length - visible.length,
      implemented: implemented.length,
      byTree: Object.fromEntries(
        ["Destruction", "Guardian", "Control", "Flow", "Harmony"].map((tree) => [
          tree,
          {
            visible: visible.filter((t) => t.tree === tree).length,
            implemented: implemented.filter((t) => t.tree === tree).length,
            talents: visible
              .filter((t) => t.tree === tree)
              .sort((a, b) => a.tier - b.tier || (a.layoutOrder ?? 99) - (b.layoutOrder ?? 99) || a.id.localeCompare(b.id)),
          },
        ]),
      ),
      implementedList: implemented.map((t) => t.id),
    },
    null,
    2,
  ),
);
