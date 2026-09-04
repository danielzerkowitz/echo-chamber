import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppDataProvider } from "@/components/providers/AppData";
import { Sidebar } from "@/components/shell/Sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppDataProvider userId={user.id}>
      <div className="mx-auto flex h-dvh max-w-[1600px]">
        <Sidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </AppDataProvider>
  );
}
