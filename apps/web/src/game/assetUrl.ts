/**
 * Resolve a public/ asset path for both Vite web (`base: /`) and Electron (`base: ./`).
 * Never use a leading "/" alone — that breaks under file:// in the packaged app.
 */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\//, "");
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${clean}`;
}
