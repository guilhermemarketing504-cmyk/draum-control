import { redirect } from "next/navigation";
import { countUsers } from "@/server/users";
import { AuthShell, SetupForm } from "../login/parts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Primeiro acesso" };

export default async function Setup() {
  if ((await countUsers()) > 0) redirect("/login");
  return <AuthShell title="Primeiro acesso" subtitle="Crie o administrador principal. Esta tela só funciona enquanto não houver usuários."><SetupForm /></AuthShell>;
}
