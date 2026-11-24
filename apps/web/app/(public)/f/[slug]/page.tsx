import { notFound } from "next/navigation";

import { AppError } from "@/lib/errors";
import { HostedForm } from "@/components/public/hosted-form";
import { resolvePrefill } from "@/lib/prefill";
import { getPublishedForm } from "@/services/public-forms";

export const dynamic = "force-dynamic";

export default async function HostedFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    embed?: string | string[];
    prefill?: string | string[];
  }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const published = await getPublishedForm(slug).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <HostedForm
      key={slug}
      compact={query.embed === "1"}
      collectMetadata={published.form.collectMetadata}
      closedMessage={
        published.intake.closed ? published.intake.message : undefined
      }
      prefill={resolvePrefill(published.version.schema, query.prefill)}
      schema={published.version.schema}
      slug={slug}
      versionId={published.version.id}
    />
  );
}
