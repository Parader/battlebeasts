/** Server-side admin allowlist for testing grants. */

const DEFAULT_ADMIN_EMAILS = ["derick0232@gmail.com"];

function parseEnvEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const ADMIN_SET = new Set(
  [...DEFAULT_ADMIN_EMAILS, ...parseEnvEmails()].map((e) => e.toLowerCase()),
);

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return ADMIN_SET.has(email.trim().toLowerCase());
}

export const ADMIN_GRANT_MAX_PER_FIELD = 100_000;
