import { Card, CardContent, CardHeader } from "@form-forge/ui";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/options";
import { getSession } from "@/auth/session";
import { AuthError } from "@/components/auth-error";
import { SignInButton } from "@/components/sign-in-button";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { providerLabels } from "@/components/provider-icon";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; linked?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const methods = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));
  const { error, linked } = await searchParams;
  const linkedProviders = methods.map(({ provider }) => provider);
  const linkedLabel =
    linked &&
    Object.hasOwn(providerLabels, linked) &&
    linkedProviders.includes(linked)
      ? providerLabels[linked as keyof typeof providerLabels]
      : undefined;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/app" className="text-sm text-slate-600 hover:underline">
          ← Workspaces
        </Link>
        <div className="flex gap-3">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold">Account</h1>
          <p className="mt-2 font-medium">
            {session.user.name || "Form Forge account"}
          </p>
          {session.user.email ? (
            <p className="text-sm text-slate-600">{session.user.email}</p>
          ) : null}
        </CardHeader>
        <CardContent>
          <h2 className="mb-2 font-semibold">Sign-in methods</h2>
          <p className="mb-5 text-sm text-slate-600">
            Link another method while signed in to keep the same account and all
            your workspaces. Matching email addresses alone do not link
            accounts.
          </p>
          <AuthError error={error} />
          {linkedLabel && !error ? (
            <p role="status" className="mb-4 text-sm text-emerald-700">
              {linkedLabel} is linked to this account.
            </p>
          ) : null}
          <SignInButton
            enabledProviders={authOptions.providers.map(({ id }) => id)}
            linkedProviders={linkedProviders}
            linking
          />
        </CardContent>
      </Card>
    </main>
  );
}
