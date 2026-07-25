import fs from "node:fs";

const text = fs.readFileSync(".cursor/talent-catalog-extract.txt", "utf8");
const lines = text.split(/\r?\n/);
let inTalents = false;
const rows = [];

for (const line of lines) {
  if (line.startsWith("=== SHEET: Talents")) {
    inTalents = true;
    continue;
  }
  if (line.startsWith("=== SHEET:")) {
    inTalents = false;
    continue;
  }
  if (!inTalents) continue;
  if (!line || line.startsWith("Talent ID")) continue;
  const parts = line.split("\t");
  if (parts.length < 9) continue;
  const [id, tree, tier, req, name, cost, tags, effect, note] = parts;
  if (!/^[A-Z]{3}_\d+$/.test(id)) continue;
  rows.push({
    id,
    tree,
    tier: +tier,
    requiredPoints: +req,
    name,
    pointCost: +cost,
    affectedTags: tags.split(/,\s*/).filter(Boolean),
    exactEffect: effect,
    balanceNote: note || "",
  });
}

const esc = (s) => JSON.stringify(s);
const chunks = [];
chunks.push("/**");
chunks.push(" * Design-only talent catalog (100 entries from workbook).");
chunks.push(" * Not equippable — promote into live TALENTS one-by-one.");
chunks.push(" */");
chunks.push('import type { SpellTag } from "./abilities";');
chunks.push("");
chunks.push("export type TalentTreeId =");
chunks.push('  | "Destruction"');
chunks.push('  | "Guardian"');
chunks.push('  | "Flow"');
chunks.push('  | "Harmony"');
chunks.push('  | "Control";');
chunks.push("");
chunks.push("export type CatalogTalentDef = {");
chunks.push("  id: string;");
chunks.push("  tree: TalentTreeId;");
chunks.push("  tier: number;");
chunks.push("  requiredPoints: number;");
chunks.push("  name: string;");
chunks.push("  pointCost: number;");
chunks.push("  affectedTags: readonly SpellTag[];");
chunks.push("  exactEffect: string;");
chunks.push("  balanceNote: string;");
chunks.push('  status: "catalog";');
chunks.push("  /** Combat-ready when true; omit/false = WIP preview. */");
chunks.push("  implemented?: boolean;");
chunks.push("};");
chunks.push("");
chunks.push("/** True only when explicitly marked combat-ready. */");
chunks.push("export function isCatalogTalentImplemented(def: CatalogTalentDef | undefined): boolean {");
chunks.push("  return def?.implemented === true;");
chunks.push("}");
chunks.push("");
chunks.push("export const TALENT_CATALOG: Record<string, CatalogTalentDef> = {");

for (const r of rows) {
  const tagLit = r.affectedTags.map(esc).join(", ");
  chunks.push(`  ${esc(r.id)}: {`);
  chunks.push(`    id: ${esc(r.id)},`);
  chunks.push(`    tree: ${esc(r.tree)},`);
  chunks.push(`    tier: ${r.tier},`);
  chunks.push(`    requiredPoints: ${r.requiredPoints},`);
  chunks.push(`    name: ${esc(r.name)},`);
  chunks.push(`    pointCost: ${r.pointCost},`);
  chunks.push(`    affectedTags: [${tagLit}] as const,`);
  chunks.push(`    exactEffect: ${esc(r.exactEffect)},`);
  chunks.push(`    balanceNote: ${esc(r.balanceNote)},`);
  chunks.push(`    status: "catalog",`);
  chunks.push("  },");
}

chunks.push("};");
chunks.push("");
chunks.push("export const TALENT_CATALOG_IDS = Object.keys(TALENT_CATALOG);");
chunks.push("");

fs.writeFileSync("packages/shared/src/talentCatalog.ts", chunks.join("\n"));
console.log("wrote", rows.length, "talents");
