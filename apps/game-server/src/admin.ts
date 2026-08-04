import { isAdminEmail as sharedIsAdminEmail } from "@battlebeasts/shared";

/** Server-side admin allowlist for testing grants (DEFAULT + ADMIN_EMAILS env). */

function parseEnvEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  return sharedIsAdminEmail(email, parseEnvEmails());
}

export const ADMIN_GRANT_MAX_PER_FIELD = 100_000;
