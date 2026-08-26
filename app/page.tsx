import Link from "next/link";
import {
  Combine,
  Scissors,
  LayoutGrid,
  ShieldCheck,
  Zap,
  Infinity as InfinityIcon,
  PenLine,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { HeroDropzone } from "@/components/HeroDropzone";

const tools = [
  {
    href: "/edit",
    name: "Edit PDF",
    desc: "Add text, shapes, drawings and images to any PDF.",
    icon: PenLine,
    highlight: true,
  },
  {
    href: "/merge",
    name: "Merge PDF",
    desc: "Combine multiple PDFs into a single document.",
    icon: Combine,
    highlight: false,
  },
  {
    href: "/split",
    name: "Split PDF",
    desc: "Extract specific pages into a separate file.",
    icon: Scissors,
    highlight: false,
  },
  {
    href: "/organize",
    name: "Organize PDF",
    desc: "Visually reorder, rotate and delete pages.",
    icon: LayoutGrid,
    highlight: false,
  },
];

const perks = [
  {
    icon: ShieldCheck,
    title: "100% private",
    desc: "Everything runs in your browser. Your files never touch a server.",
  },
  {
    icon: Zap,
    title: "Instant",
    desc: "No uploads, no queues. Edits apply in real time.",
  },
  {
    icon: InfinityIcon,
    title: "Free & unlimited",
    desc: "No accounts, no watermarks, no daily limits.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {tools.slice(0, 3).map((t) => (
              <Link key={t.href} href={t.href} className="hover:text-brand-600">
                {t.name}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-96 max-w-4xl rounded-full bg-brand-200/40 blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-24">
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              Every PDF tool you need.
              <span className="block text-brand-600">Right in your browser.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
              Edit, merge, split and organize PDF files in seconds — free,
              private, and without uploading anything to a server.
            </p>
            <div className="mt-10">
              <HeroDropzone />
            </div>
            <p className="mt-4 text-sm text-slate-400">
              By using this tool you agree that files are processed locally on
              your device.
            </p>
          </div>
        </section>

        {/* Tools grid */}
        <section className="mx-auto max-w-6xl px-4 pb-8">
          <h2 className="mb-8 text-center text-2xl font-bold text-slate-900">
            All the tools, one place
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tools.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className={`group flex flex-col rounded-2xl border p-6 transition hover:-translate-y-0.5 hover:shadow-lg ${
                  tool.highlight
                    ? "border-brand-200 bg-white shadow-sm ring-2 ring-brand-500/60"
                    : "border-slate-200 bg-white shadow-sm"
                }`}
              >
                <span
                  className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl transition group-hover:scale-110 ${
                    tool.highlight
                      ? "bg-brand-600 text-white"
                      : "bg-brand-50 text-brand-600"
                  }`}
                >
                  <tool.icon className="h-6 w-6" />
                </span>
                <span className="font-semibold text-slate-900">
                  {tool.name}
                </span>
                <span className="mt-1 text-sm leading-relaxed text-slate-500">
                  {tool.desc}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Perks */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-10 sm:grid-cols-3">
            {perks.map((p) => (
              <div key={p.title} className="flex flex-col items-center text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white">
                  <p.icon className="h-6 w-6" />
                </span>
                <h3 className="font-semibold text-slate-900">{p.title}</h3>
                <p className="mt-1 max-w-xs text-sm text-slate-500">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} PDF Pilot. Files stay on your device.</p>
        </div>
      </footer>
    </div>
  );
}
