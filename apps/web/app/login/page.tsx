import { Card, CardContent, CardHeader } from "@form-forge/ui";
import { redirect } from "next/navigation";

import { getSession } from "@/auth/session";
import { SignInButton } from "@/components/sign-in-button";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/app");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-sm font-medium text-blue-700">Form Forge</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Sign in to your workspace
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage forms, submissions, versions, and delivery failures.
          </p>
        </CardHeader>
        <CardContent>
          <SignInButton />
        </CardContent>
      </Card>
    </main>
  );
}
