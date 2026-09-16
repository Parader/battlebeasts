import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packScript = path.join(desktop, "scripts", "pack-content.mjs");
const outDir = path.join(desktop, "dist-content");

function run(command, args, opts = {}) {
  const spawnOpts = {
    cwd: opts.cwd,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  };
  const result =
    process.platform === "win32"
      ? spawnSync(quoteWinCmd(command, args), { ...spawnOpts, shell: true })
      : spawnSync(command, args, spawnOpts);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with ${result.status}`);
  }
}

function quoteWinCmd(command, args) {
  const q = (s) => `"${String(s).replaceAll('"', '\\"')}"`;
  return [q(command), ...args.map(q)].join(" ");
}

function notesBody(latest) {
  const lines = [`# ${latest.title || latest.contentVersion}`, ""];
  const sections = [
    ["Balance", latest.notes?.balance],
    ["Bug fixes", latest.notes?.fixes],
    ["New content", latest.notes?.content],
    ["Updates", latest.notes?.highlights],
  ];
  let any = false;
  for (const [label, items] of sections) {
    if (!Array.isArray(items) || items.length === 0) continue;
    any = true;
    lines.push(`## ${label}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  if (!any) lines.push("_No patch notes._", "");
  return lines.join("\n");
}

console.log("Packing game content…");
run(process.execPath, [packScript]);

const latestPath = path.join(outDir, "latest.json");
if (!fs.existsSync(latestPath)) {
  throw new Error("pack-content did not write latest.json");
}
const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
const tag = latest.releaseTag || `game-${latest.contentVersion}`;
const files = [
  latestPath,
  path.join(outDir, "content.zip"),
  path.join(outDir, "manifest.json"),
];
const patchZip = path.join(outDir, "patch.zip");
if (fs.existsSync(patchZip)) files.push(patchZip);

const notesFile = path.join(outDir, "RELEASE_NOTES.md");
fs.writeFileSync(notesFile, notesBody(latest));

console.log(`Creating GitHub release ${tag}…`);
run("gh", [
  "release",
  "create",
  tag,
  ...files,
  "--title",
  latest.title || tag,
  "--notes-file",
  notesFile,
  "--latest",
]);

console.log(`Published ${tag}`);
