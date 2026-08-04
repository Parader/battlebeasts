import {
  TALENT_CATALOG,
  layoutTalentTree,
  talentTreeLinks,
  talentMaxRank,
  TALENT_TREE_IDS,
  isCatalogTalentImplemented,
} from '@battlebeasts/shared';
import { writeFileSync } from 'fs';

function status(t: { hidden?: boolean; implemented?: boolean }) {
  if (t.hidden) return 'hidden';
  if (isCatalogTalentImplemented(t as any)) return 'LIVE';
  return 'stub';
}

const lines: string[] = [];
for (const tree of TALENT_TREE_IDS) {
  const { cells, rowCount } = layoutTalentTree(tree);
  const links = talentTreeLinks(cells);
  lines.push('TREE ' + tree + ' rows=' + rowCount + ' cells=' + cells.length);
  const byRow = new Map<number, typeof cells>();
  for (const c of cells) {
    const list = byRow.get(c.row) ?? [];
    list.push(c);
    byRow.set(c.row, list);
  }
  for (const r of [...byRow.keys()].sort((a,b)=>a-b)) {
    const list = (byRow.get(r) ?? []).sort((a,b)=>a.col-b.col);
    lines.push('ROW ' + r + ' ' + list.map(c => c.col+':'+c.talent.id+':'+c.talent.name+':mr'+talentMaxRank(c.talent)+':'+status(c.talent)+':tier'+c.talent.tier+':req'+c.talent.requiredPoints).join(' | '));
  }
  lines.push('LINKS ' + links.map(l => l.fromId+'>'+l.toId).join(', '));
  lines.push('---');
}
// all non-hidden by tree for effect table
for (const tree of TALENT_TREE_IDS) {
  lines.push('EFFECTS ' + tree);
  const talents = Object.values(TALENT_CATALOG).filter(t => t.tree === tree && !t.hidden).sort((a,b) => a.tier - b.tier || (a.layoutOrder??99) - (b.layoutOrder??99) || a.id.localeCompare(b.id));
  for (const t of talents) {
    lines.push([t.id, t.name, 't'+t.tier, 'mr'+talentMaxRank(t), status(t), t.exactEffect, (t.requires??[]).join('+')].join('\t'));
  }
}
writeFileSync('C:/solo/battlebeasts2/scripts/_talent-dump.txt', lines.join('\n'));
console.error('wrote', lines.length);
