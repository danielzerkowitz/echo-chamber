"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setNotice("Check your email for a confirmation link, then sign in.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-wa-app">
      <div className="h-56 w-full bg-wa-accent-deep" />
      <div className="-mt-40 w-full max-w-md px-4">
        <div className="rounded-lg bg-wa-panel p-8 shadow-xl">
          <div className="mb-6 flex items-center gap-3">
            <span className="text-4xl">💬</span>
            <div>
              <h1 className="text-xl font-semibold text-wa-text">Echo Chamber</h1>
              <p className="text-sm text-wa-text-soft">WhatsApp for your bots</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-wa-text outline-none focus:border-wa-accent"
            />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-md border border-wa-border bg-wa-panel-deep px-3 py-2 text-wa-text outline-none focus:border-wa-accent"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            {notice && <p className="text-sm text-wa-accent">{notice}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-wa-accent py-2 font-medium text-white transition hover:bg-wa-accent-deep disabled:opacity-50"
            >
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
            className="mt-4 text-sm text-wa-accent hover:underline"
          >
            {mode === "signin" ? "No account yet? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
