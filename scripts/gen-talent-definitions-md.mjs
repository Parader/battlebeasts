/**
 * Regenerate the talent catalog appendix in docs/talent-definitions.md
 * Usage: node scripts/gen-talent-definitions-md.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "tools/talent-extract.json"), "utf8").replace(/^\uFEFF/, "");
const extract = JSON.parse(raw);

function maxRankNote(t) {
  if (t.maxRank === 1) return "1";
  if (t.maxRank) return String(t.maxRank);
  if (t.tier === 1 && t.pointCost === 1) return "3 (default)";
  return "1 (default)";
}

function row(t) {
  const live = t.implemented ? "✓" : "";
  const req = t.requires?.length ? t.requires.join(", ") : "—";
  const tags = t.affectedTags?.length ? t.affectedTags.join(", ") : "—";
  const effect = (t.exactEffect ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return `| \`${t.id}\` | ${t.tier} | ${t.pointCost} | ${maxRankNote(t)} | ${t.requiredPoints} | ${live} | ${req} | ${tags} | ${effect} |`;
}

function treeSection(tree, data) {
  const lines = [
    `### ${tree} (${data.visible} visible, ${data.implemented} live)`,
    "",
    "| id | tier | cost/rank | max ranks | tier gate | live | requires | affectedTags | exactEffect |",
    "|----|------|-----------|-----------|-----------|------|----------|--------------|-------------|",
    ...data.talents.map(row),
    "",
  ];
  return lines.join("\n");
}

const catalogMd = [
  "## Full catalog (visible talents)",
  "",
  `**${extract.visible}** talents shown in the tree UI (**${extract.hidden}** hidden design entries omitted). **` +
    `${extract.implemented}** are combat-live today.`,
  "",
  ...Object.entries(extract.byTree).flatMap(([tree, data]) => treeSection(tree, data)),
].join("\n");

const header = readFileSync(join(root, "docs/talent-definitions.md"), "utf8");
const marker = "<!-- CATALOG:AUTO -->";
const endMarker = "<!-- /CATALOG:AUTO -->";
const start = header.indexOf(marker);
const end = header.indexOf(endMarker);
if (start === -1 || end === -1) {
  console.error("Markers not found in docs/talent-definitions.md");
  process.exit(1);
}
const out =
  header.slice(0, start + marker.length) +
  "\n\n" +
  catalogMd +
  "\n\n" +
  header.slice(end);
writeFileSync(join(root, "docs/talent-definitions.md"), out, "utf8");
console.log("Updated catalog section in docs/talent-definitions.md");
