import { FormRenderer } from "@form-forge/form-renderer";
import type { FormSchemaV1 } from "@form-forge/form-schema";
import { Alert, Card, CardContent } from "@form-forge/ui";
import type { ZodError } from "zod";

import { webRendererComponents } from "@/components/renderer-adapter";

export const SchemaPreview = ({
  result,
}: {
  result:
    { success: true; data: FormSchemaV1 } | { success: false; error: ZodError };
}) => (
  <Card>
    <div className="border-b border-slate-100 px-5 py-4">
      <h2 className="font-semibold">Preview</h2>
      <p className="mt-1 text-sm text-slate-600">
        Uses the same renderer as the hosted form.
      </p>
    </div>
    <CardContent>
      {result.success ? (
        <div className="[&_form>button]:mt-6 [&_form>div]:grid [&_form>div]:gap-5 [&_form>div]:sm:grid-cols-2">
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
        <Alert>
          Preview is unavailable until the schema is valid.
          <ul className="mt-2 list-disc pl-5">
            {result.error.issues.slice(0, 5).map((issue) => (
              <li key={`${issue.path.join(".")}-${issue.message}`}>
                {issue.path.join(".") || "schema"}: {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </CardContent>
  </Card>
);
