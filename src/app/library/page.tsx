import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LibraryPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <main className="flex flex-1 flex-col p-8">
      <h1 className="text-2xl font-bold text-foreground">Library</h1>
      <p className="mt-2 text-foreground/60">
        Welcome, {session.user?.name || "there"}. Your collections will appear
        here.
      </p>
    </main>
  );
}
