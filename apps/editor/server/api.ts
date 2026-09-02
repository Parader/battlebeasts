/**
 * Dev-server API for the map editor.
 *
 * Runs inside Vite rather than as a separate process so saving writes a real,
 * git-tracked file on disk. The File System Access API was the alternative and
 * is a worse fit: permission prompts per session, no stable path, and nothing
 * for the build-prune step to read.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";
import { encodePng } from "./png";

const run = promisify(execFile);

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MANIFEST = path.join(REPO_ROOT, "data", "props.manifest.json");
/**
 * Props marked unusable from inside the editor -- too small to see, badly
 * centred, or broken.
 *
 * A separate file from the manifest on purpose: the manifest is regenerated
 * wholesale by `pnpm gen:props`, which would erase anything written into it.
 * This list is hand-editable and survives that.
 */
const UNUSABLE = path.join(REPO_ROOT, "data", "props.unusable.json");
/**
 * Colliders corrected by hand in the editor, keyed by prop model.
 *
 * Same reasoning as the unusable list: `pnpm gen:props` rewrites the manifest
 * wholesale, so a correction stored there would not survive the next asset
 * import. Keeping it separate means fixing a model once fixes it everywhere,
 * permanently.
 */
const COLLIDERS = path.join(REPO_ROOT, "data", "props.colliders.json");
const MAPS_DIR = path.join(REPO_ROOT, "packages", "shared", "src", "maps");
/** Sidecars are served to the client, so they live under the web public dir. */
const SIDECAR_DIR = path.join(REPO_ROOT, "apps", "web", "public", "assets", "maps");

/** Map ids become filenames, so keep them boring. Also blocks path traversal. */
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type Json = Record<string, unknown>;

/**
 * Rebuild the authored-map index after the set of map files changes.
 *
 * The index is a generated module of static imports, so a map that exists on
 * disk is invisible to the game until it is regenerated. Doing it here means
 * creating a map in the editor is enough; forgetting `pnpm gen:maps` used to
 * leave a saved map that simply never loaded.
 *
 * Failure is reported but never fatal -- the document itself is already safely
 * written, and the index can always be rebuilt by hand.
 */
async function regenMapIndex(): Promise<string | null> {
  try {
    await run(process.execPath, [path.join(REPO_ROOT, "scripts", "gen-map-index.mjs")], {
      cwd: REPO_ROOT,
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function send(res: import("node:http").ServerResponse, status: number, body: Json | unknown[]) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Splat/height data goes in sidecars, so documents stay small.
    if (size > 32 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function editorApi(): Plugin {
  return {
    name: "bb-editor-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/api/")) return next();

        try {
          // --- prop manifest ---
          if (url === "/api/props" && req.method === "GET") {
            try {
              const raw = await fs.readFile(MANIFEST, "utf8");
              res.statusCode = 200;
              res.setHeader("content-type", "application/json");
              res.setHeader("cache-control", "no-store");
              res.end(raw);
            } catch {
              send(res, 503, {
                error: "props manifest missing -- run `pnpm gen:props`",
                expectedAt: path.relative(REPO_ROOT, MANIFEST),
              });
            }
            return;
          }

          // --- unusable prop list ---
          if (url === "/api/props/unusable") {
            if (req.method === "GET") {
              const raw = await fs.readFile(UNUSABLE, "utf8").catch(() => null);
              let keys: string[] = [];
              if (raw) {
                try {
                  const parsed = JSON.parse(raw);
                  if (Array.isArray(parsed?.keys)) keys = parsed.keys.filter((k: unknown) => typeof k === "string");
                } catch {
                  // A corrupt list must not break the palette; an empty list
                  // shows everything, which is the recoverable failure.
                  keys = [];
                }
              }
              send(res, 200, { keys });
              return;
            }

            if (req.method === "PUT") {
              const body = (await readBody(req)) as Json;
              const raw = Array.isArray(body?.keys) ? body.keys : null;
              if (!raw) {
                send(res, 400, { error: "expected { keys: string[] }" });
                return;
              }
              // Sorted and deduped so the file diffs cleanly no matter what
              // order the editor happened to mark things in.
              const keys = [...new Set(raw.filter((k): k is string => typeof k === "string"))].sort();
              await fs.mkdir(path.dirname(UNUSABLE), { recursive: true });
              await fs.writeFile(UNUSABLE, `${JSON.stringify({ keys }, null, 2)}\n`, "utf8");
              send(res, 200, { ok: true, count: keys.length });
              return;
            }
          }

          // --- hand-corrected colliders, per prop model ---
          if (url === "/api/props/colliders") {
            if (req.method === "GET") {
              const raw = await fs.readFile(COLLIDERS, "utf8").catch(() => null);
              let colliders: Record<string, unknown> = {};
              if (raw) {
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed?.colliders && typeof parsed.colliders === "object") {
                    colliders = parsed.colliders;
                  }
                } catch {
                  // A corrupt file must not break placement; falling back to
                  // fitted defaults is the recoverable failure.
                  colliders = {};
                }
              }
              send(res, 200, { colliders });
              return;
            }

            if (req.method === "PUT") {
              const body = (await readBody(req)) as Json;
              const raw = body?.colliders;
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                send(res, 400, { error: "expected { colliders: Record<string, spec> }" });
                return;
              }
              // Key-sorted so the file diffs cleanly no matter what order the
              // corrections were made in.
              const colliders = Object.fromEntries(
                Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
                  a.localeCompare(b),
                ),
              );
              await fs.mkdir(path.dirname(COLLIDERS), { recursive: true });
              await fs.writeFile(
                COLLIDERS,
                `${JSON.stringify({ colliders }, null, 2)}\n`,
                "utf8",
              );
              send(res, 200, { ok: true, count: Object.keys(colliders).length });
              return;
            }
          }

          // --- list maps ---
          if (url === "/api/maps" && req.method === "GET") {
            const entries = await fs.readdir(MAPS_DIR).catch(() => [] as string[]);
            const maps = [];
            for (const file of entries) {
              if (!file.endsWith(".map.json")) continue;
              const id = file.slice(0, -".map.json".length);
              let name = id;
              try {
                const doc = JSON.parse(await fs.readFile(path.join(MAPS_DIR, file), "utf8"));
                if (typeof doc?.name === "string") name = doc.name;
              } catch {
                name = `${id} (unreadable)`;
              }
              maps.push({ id, name });
            }
            send(res, 200, maps);
            return;
          }

          // --- read / write one map ---
          const match = /^\/api\/maps\/([^/]+)$/.exec(url);
          if (match) {
            const id = decodeURIComponent(match[1]!);
            if (!SAFE_ID.test(id)) {
              send(res, 400, { error: `invalid map id "${id}"` });
              return;
            }
            const file = path.join(MAPS_DIR, `${id}.map.json`);

            if (req.method === "GET") {
              try {
                const raw = await fs.readFile(file, "utf8");
                res.statusCode = 200;
                res.setHeader("content-type", "application/json");
                res.setHeader("cache-control", "no-store");
                res.end(raw);
              } catch {
                send(res, 404, { error: `no map "${id}"` });
              }
              return;
            }

            if (req.method === "PUT" || req.method === "POST") {
              const body = (await readBody(req)) as Json;
              const doc = (body?.doc ?? body) as Json;
              if (doc?.id !== id) {
                send(res, 400, { error: `document id "${String(doc?.id)}" does not match "${id}"` });
                return;
              }

              /*
               * Whether this is a new map decides if the index needs rebuilding.
               *
               * The index lists which maps exist, so re-saving one changes
               * nothing in it. Regenerating anyway rewrote a file the game and
               * server both watch, so every save cost a second page reload and
               * a second server restart on top of the one the document itself
               * triggers -- enough to abort in-flight glTF loads.
               */
              const isNew = !(await fs
                .access(file)
                .then(() => true)
                .catch(() => false));

              await fs.mkdir(MAPS_DIR, { recursive: true });
              // Write-then-rename so an interrupted save cannot truncate a map.
              const tmp = `${file}.tmp`;
              await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
              await fs.rename(tmp, file);

              /*
               * Optional painted-ground sidecars.
               *
               * The client sends raw base64 samples and we encode the PNG
               * here. Letting the browser encode via canvas would premultiply
               * alpha and destroy splat weights wherever the fourth layer is
               * unpainted.
               */
              const written: string[] = [path.relative(REPO_ROOT, file)];
              const sidecars = [
                { key: "splat", suffix: "splat.png", channels: 4 as const },
                { key: "height", suffix: "height.png", channels: 1 as const },
              ];
              for (const { key, suffix, channels } of sidecars) {
                const raw = body?.[key];
                if (!raw || typeof raw !== "object") continue;
                const { width, height, data } = raw as Json;
                if (typeof width !== "number" || typeof height !== "number" || typeof data !== "string") {
                  send(res, 400, { error: `${key} sidecar must be { width, height, data }` });
                  return;
                }
                const png = encodePng(
                  new Uint8Array(Buffer.from(data, "base64")),
                  width,
                  height,
                  channels,
                );
                const out = path.join(SIDECAR_DIR, `${id}.${suffix}`);
                await fs.mkdir(SIDECAR_DIR, { recursive: true });
                await fs.writeFile(out, png);
                written.push(path.relative(REPO_ROOT, out));
              }

              const indexError = isNew ? await regenMapIndex() : null;
              send(res, 200, { ok: true, written, indexError });
              return;
            }

            if (req.method === "DELETE") {
              try {
                await fs.unlink(file);
              } catch {
                send(res, 404, { error: `no map "${id}"` });
                return;
              }
              // Sidecars are optional, so a missing one is not an error.
              for (const suffix of ["splat.png", "height.png"]) {
                await fs.unlink(path.join(SIDECAR_DIR, `${id}.${suffix}`)).catch(() => {});
              }
              const indexError = await regenMapIndex();
              send(res, 200, { ok: true, indexError });
              return;
            }
          }

          send(res, 404, { error: `no route for ${req.method} ${url}` });
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
