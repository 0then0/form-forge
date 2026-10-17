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
      "Publish immutable versions and keep the schema behind every response.",
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
          Free and open-source form platform
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          Forms with an inspectable delivery pipeline.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Define a schema, publish an immutable version, collect submissions,
          and understand exactly what happened to every webhook.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-500">
          Self-hosted, libre software under Apache 2.0. Free to use, study,
          modify, and share.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href={workspaceHref}>
              Open the workspace <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <a href="https://github.com/0then0/form-forge">View source</a>
          </Button>
        </div>
      </section>
      <section
        aria-label="Features"
        className="mx-auto grid max-w-6xl gap-4 px-6 pb-12 md:grid-cols-3"
      >
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
      <section
        aria-labelledby="privacy-heading"
        className="mx-auto max-w-6xl px-6 pb-24"
      >
        <div className="grid gap-6 border-t border-slate-200 pt-8 md:grid-cols-[1fr_2fr]">
          <div>
            <h2
              id="privacy-heading"
              className="text-xl font-semibold tracking-tight text-slate-950"
            >
              Privacy and ownership
            </h2>
            <a
              href="https://github.com/0then0/form-forge/blob/main/LICENSE"
              className="mt-3 inline-block text-sm text-blue-700 underline underline-offset-4"
            >
              Apache 2.0 license
            </a>
          </div>
          <div className="space-y-3 text-sm leading-7 text-slate-600">
            <p>
              Form Forge includes no product analytics or advertising trackers
              and sends no usage reports to the project authors.
            </p>
            <p>
              Responses and submission metadata are stored in your own database.
              You control the code, the deployment, and the data. Optional
              Sentry error and performance reporting is configured by the
              deployment owner.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
