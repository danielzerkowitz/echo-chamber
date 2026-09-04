import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export async function requireUser(): Promise<{ user: User } | { error: Response }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { user };
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
