import { Button } from "@form-forge/ui";
import { ArrowRight, Braces, RefreshCcw, Webhook } from "lucide-react";
import Link from "next/link";

import { getSession } from "@/auth/session";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

const features = [
  {
    icon: Braces,
    title: "Schema-first forms",
    description:
      "Explicit, versioned definitions instead of opaque JSON blobs.",
  },
  {
    icon: Webhook,
    title: "Observable delivery",
    description: "Every delivery attempt, error, and response is inspectable.",
  },
  {
    icon: RefreshCcw,
    title: "Reliable retries",
    description: "Durable background delivery with controlled manual recovery.",
  },
];

export default async function MarketingPage() {
  const session = await getSession();
  const isSignedIn = Boolean(session?.user?.id);
  const workspaceHref = isSignedIn ? "/app" : "/login";

  return (
    <main>
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight whitespace-nowrap text-slate-950"
        >
          <BrandMark />
          <span>Form Forge</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Button asChild variant="secondary" size="sm">
            <Link href={workspaceHref}>
              {isSignedIn ? "Open workspace" : "Sign in"}
            </Link>
          </Button>
        </div>
      </nav>
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <p className="text-sm font-medium text-blue-700">
          Headless form platform
        </p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          Forms with an inspectable delivery pipeline.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Define a schema, publish an immutable version, collect submissions,
          and understand exactly what happened to every webhook.
        </p>
        <Button asChild className="mt-8">
          <Link href={workspaceHref}>
            Open the workspace <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
        {features.map((feature) => (
          <article
            key={feature.title}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <feature.icon className="size-5 text-blue-700" />
            <h2 className="mt-4 font-semibold text-slate-950">
              {feature.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {feature.description}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
