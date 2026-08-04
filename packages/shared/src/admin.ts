/** Game admin allowlist (UI + server). Server may also extend via ADMIN_EMAILS env. */

export const DEFAULT_ADMIN_EMAILS = ["derick0232@gmail.com"] as const;

export function isAdminEmail(
  email: string | undefined | null,
  extraEmails: readonly string[] = [],
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (DEFAULT_ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized)) return true;
  return extraEmails.some((e) => e.trim().toLowerCase() === normalized);
}
