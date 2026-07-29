import { createClient, type User } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serverKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;
const allowGuests = process.env.ALLOW_GUESTS !== "false";

const supabase = url && serverKey ? createClient(url, serverKey) : null;

export type AuthJoinOptions = {
  userId?: string;
  displayName?: string;
  color?: string;
  accessToken?: string;
  /** Whose base city this room belongs to (filterBy key). */
  hubOwnerId?: string;
};

export type VerifiedIdentity = {
  userId: string;
  displayName: string;
  color?: string;
  isGuest: boolean;
  email?: string;
};

export async function verifyJoinOptions(options: AuthJoinOptions): Promise<VerifiedIdentity> {
  if (options.accessToken && supabase) {
    const { data, error } = await supabase.auth.getUser(options.accessToken);
    if (error || !data.user) {
      throw new Error("Invalid auth token");
    }
    return identityFromUser(data.user, options);
  }

  if (supabase && !allowGuests) {
    throw new Error("Authentication required");
  }

  const userId = options.userId?.startsWith("guest_")
    ? options.userId
    : `guest_${options.userId ?? Math.random().toString(36).slice(2, 9)}`;

  return {
    userId,
    displayName: options.displayName ?? "Hunter",
    color: options.color,
    isGuest: true,
  };
}

function identityFromUser(user: User, options: AuthJoinOptions): VerifiedIdentity {
  const meta = user.user_metadata ?? {};
  return {
    userId: user.id,
    displayName:
      options.displayName ||
      meta.full_name ||
      meta.name ||
      user.email?.split("@")[0] ||
      "Hunter",
    color: options.color,
    isGuest: false,
    email: user.email ?? undefined,
  };
}
