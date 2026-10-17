import { Card, CardContent, CardHeader } from "@form-forge/ui";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/options";
import { AuthError } from "@/components/auth-error";
import { getSession } from "@/auth/session";
import { BrandMark } from "@/components/brand-mark";
import { SignInButton } from "@/components/sign-in-button";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getSession();
  if (session)
    redirect(error ? `/account?error=${encodeURIComponent(error)}` : "/app");

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-12">
      <ThemeToggle className="absolute top-4 right-4 sm:top-6 sm:right-6" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
            <BrandMark />
            <span>Form Forge</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Sign in to your workspace
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage forms, submissions, versions, and delivery failures.
          </p>
        </CardHeader>
        <CardContent>
          <AuthError error={error} />
          <SignInButton
            enabledProviders={authOptions.providers.map(({ id }) => id)}
          />
        </CardContent>
      </Card>
    </main>
  );
}
