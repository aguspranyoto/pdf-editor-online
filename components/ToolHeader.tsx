import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "./Logo";

export function ToolHeader({ toolName }: { toolName: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Logo />
        <span className="h-5 w-px bg-slate-200" aria-hidden />
        <span className="font-semibold text-slate-700">{toolName}</span>
        <Link
          href="/"
          className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          All tools
        </Link>
      </div>
    </header>
  );
}
