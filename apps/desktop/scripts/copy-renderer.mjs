import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDist = path.resolve(desktop, "../web/dist");
const renderer = path.join(desktop, "renderer");

if (!fs.existsSync(webDist)) {
  console.error(`Missing web build at ${webDist}. Run build:electron first.`);
  process.exit(1);
}

fs.rmSync(renderer, { recursive: true, force: true });
fs.cpSync(webDist, renderer, { recursive: true });
console.log(`Copied renderer → ${renderer}`);
