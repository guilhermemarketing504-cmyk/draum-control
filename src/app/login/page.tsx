import { redirect } from "next/navigation";
import { countUsers } from "@/server/users";
import { getSession } from "@/lib/auth";
import { AuthShell, LoginForm } from "./parts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function Login() {
  if (await getSession()) redirect("/");
  if ((await countUsers()) === 0) redirect("/setup");
  return <AuthShell title="Acesso restrito" subtitle="Entre com seu e-mail e senha."><LoginForm /></AuthShell>;
}
