import fs from "node:fs";
import path from "node:path";

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else if (ent.name.endsWith(".js")) out.push(abs);
  }
  return out;
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) return spec;
  if (spec.endsWith(".js") || spec.endsWith(".json") || spec.endsWith(".node")) return spec;
  const base = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(`${base}.js`)) return `${spec}.js`;
  if (fs.existsSync(path.join(base, "index.js"))) {
    return spec.endsWith("/") ? `${spec}index.js` : `${spec}/index.js`;
  }
  return spec;
}

const IMPORT_RE = /(from\s+|import\s*\(\s*|export\s+\*\s+from\s+)(["'])(\.[^"']+)\2/g;

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node fix-esm-extensions.mjs <dist-dir>...");
  process.exit(1);
}

for (const root of roots) {
  const absRoot = path.resolve(root);
  for (const file of walk(absRoot)) {
    const orig = fs.readFileSync(file, "utf8");
    let next = orig.replace(IMPORT_RE, (match, prefix, quote, spec) => {
      const fixed = resolveSpecifier(file, spec);
      if (fixed === spec) return match;
      return `${prefix}${quote}${fixed}${quote}`;
    });
    next = next.replace(
      /(from\s+|import\s*\(\s*)(["'])(\.[^"']+\.json)\2(?!\s*with)/g,
      `$1$2$3$2 with { type: "json" }`,
    );
    if (next !== orig) fs.writeFileSync(file, next);
  }
}
