import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  return (
    <div className="lg:flex min-h-screen">
      <Sidebar user={{ name: user.name, role: user.role }} />
      <main className="flex-1 min-w-0 px-5 py-8 lg:px-12 lg:py-10 max-w-[1440px]">{children}</main>
    </div>
  );
}
