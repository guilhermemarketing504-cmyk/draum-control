"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutGrid, Shirt, Boxes, ReceiptText, Hourglass, Users, Factory, Wallet, Truck, Megaphone, FileSpreadsheet, Settings, LogOut, Menu, X } from "lucide-react";
import { Wordmark, Symbol } from "./brand";
import { logoutAction } from "@/app/actions/auth";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/produtos", label: "Produtos", icon: Shirt },
  { href: "/estoque", label: "Estoque", icon: Boxes },
  { href: "/pedidos", label: "Pedidos", icon: ReceiptText },
  { href: "/pre-vendas", label: "Pré-vendas", icon: Hourglass },
  { href: "/clientes", label: "Clientes e Grupo VIP", icon: Users },
  { href: "/fornecedores", label: "Fornecedores", icon: Factory },
  { href: "/financeiro", label: "Financeiro", icon: Wallet, admin: true },
  { href: "/entregas", label: "Entregas", icon: Truck },
  { href: "/marketing", label: "Marketing e Campanhas", icon: Megaphone },
  { href: "/relatorios", label: "Relatórios", icon: FileSpreadsheet },
  { href: "/configuracoes", label: "Configurações", icon: Settings, admin: true },
];

export function Sidebar({ user }: { user: { name: string; role: string } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-mineral text-offwhite px-5 h-14 no-print">
        <Wordmark className="h-4" />
        <button aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X size={20} strokeWidth={1.4} /> : <Menu size={20} strokeWidth={1.4} />}</button>
      </div>
      <aside className={`${open ? "flex" : "hidden"} lg:flex fixed lg:sticky top-14 lg:top-0 z-20 h-[calc(100vh-3.5rem)] lg:h-screen w-full lg:w-[248px] shrink-0 flex-col bg-mineral text-offwhite`}>
        <div className="hidden lg:flex items-center gap-3 px-6 pt-7 pb-6">
          <Wordmark className="h-[15px]" />
          <span className="label !text-stone !text-[9.5px] mt-0.5">Control</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {NAV.filter((n) => !n.admin || user.role === "admin").map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 h-9 px-3 rounded text-[13px] transition-colors ${active(n.href) ? "bg-grafite text-offwhite" : "text-sand/80 hover:text-offwhite hover:bg-grafite/50"}`}>
              {active(n.href) && <span className="absolute left-0 top-2 bottom-2 w-px bg-sand" style={{ transform: "rotate(7deg)" }} />}
              <n.icon size={16} strokeWidth={1.4} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="px-6 py-5 border-t border-grafite flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] truncate">{user.name}</div>
            <div className="label !text-stone !text-[9.5px]">{user.role === "admin" ? "Administrador" : "Operacional"}</div>
          </div>
          <form action={logoutAction}><button aria-label="Sair" title="Sair" className="text-stone hover:text-offwhite"><LogOut size={16} strokeWidth={1.4} /></button></form>
        </div>
        <div className="hidden lg:flex px-6 pb-5 text-stone/60"><Symbol className="h-4" /></div>
      </aside>
    </>
  );
}
