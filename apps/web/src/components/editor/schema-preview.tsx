import { FormRenderer } from "@form-forge/form-renderer";
import type { FormSchemaV1 } from "@form-forge/form-schema";
import { Alert, Card, CardContent } from "@form-forge/ui";
import { ChevronDown } from "lucide-react";
import type { ZodError } from "zod";

import { formatSchemaIssues } from "./schema-errors";
import { webRendererComponents } from "@/components/renderer-adapter";

export const SchemaPreview = ({
  result,
  draft,
}: {
  draft?: unknown;
  result:
    | { success: true; data: FormSchemaV1 }
    | { success: false; error: ZodError };
}) => (
  <Card>
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-5 py-4 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-semibold">Preview</span>
          <span className="mt-1 block text-sm text-slate-600">
            Uses the same renderer as the hosted form.
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
        />
      </summary>
      <CardContent
        className="max-h-[65dvh] overflow-y-auto overscroll-contain border-t border-slate-100"
        tabIndex={0}
        role="region"
        aria-label="Form preview"
      >
        {result.success ? (
          <div className="[&_form>button]:mt-6 [&_form>[data-form-fields]]:grid [&_form>[data-form-fields]]:gap-5 [&_form>[data-form-fields]]:sm:grid-cols-2">
            <h3 className="text-xl font-semibold">{result.data.title}</h3>
            {result.data.description ? (
              <p className="mt-2 mb-6 text-sm text-slate-600">
                {result.data.description}
              </p>
            ) : null}
            <FormRenderer
              components={webRendererComponents}
              disabled
              schema={result.data}
              onSubmit={() => undefined}
            />
          </div>
        ) : (
          <Alert tone="info" className="space-y-2">
            <p className="font-medium">
              Complete these details to see the preview
            </p>
            <ul className="list-disc space-y-1 pl-5 leading-6 wrap-anywhere">
              {formatSchemaIssues(result.error, draft).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Alert>
        )}
      </CardContent>
    </details>
  </Card>
);
