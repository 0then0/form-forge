import {
  formSchemaV1Schema,
  submissionRequestSchema,
} from "@form-forge/form-schema";
import { z } from "zod";
import { formPolicyMutationSchema } from "./form-policy";
import {
  submissionListQuerySchema,
  submissionFilterSchema,
} from "./submission-filters";
import {
  submissionDeletionSchema,
  submissionStatusMutationSchema,
} from "./submission-mutations";

// JSON Schema comes from the validators used by the routes and domain services.
const schema = (value: z.ZodType) => z.toJSONSchema(value, { io: "input" });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (value: unknown) => ({ "application/json": { schema: value } });
const body = (value: unknown) => ({ required: true, content: json(value) });
const envelope = (value: unknown) => ({
  type: "object",
  required: ["data"],
  properties: { data: value },
});
const object = { type: "object", additionalProperties: true };
const uuid = { type: "string", format: "uuid" };
const timestamp = { type: "string", format: "date-time" };
const pathParam = (name: string) => ({
  name,
  in: "path",
  required: true,
  schema: name.endsWith("Id") ? uuid : { type: "string" },
});
const queryParams = (value: z.ZodType) => {
  const converted = schema(value);
  return Object.entries(converted.properties ?? {}).map(([name, property]) => ({
    name,
    in: "query",
    required: false,
    schema: property,
  }));
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 422, 429, 500].map((status) => [
    status,
    {
      description:
        status === 409
          ? "Conflict: reused/deleted key, closed intake, concurrent mutation or active background work"
          : status === 429
            ? "Rate or quota exceeded; Retry-After is in seconds"
            : "Request failed",
      content: json(ref("Error")),
      ...(status === 429
        ? {
            headers: {
              "Retry-After": {
                schema: { type: "integer", minimum: 1 },
                description: "Seconds before retry",
              },
            },
          }
        : {}),
    },
  ]),
);
const adminSecurity = [{ session: [] }, { secureSession: [] }];
const operation = (
  id: string,
  summary: string,
  response: unknown,
  options: {
    admin?: boolean;
    status?: number;
    request?: unknown;
    parameters?: unknown[];
  } = {},
) => ({
  operationId: id,
  summary,
  security: options.admin ? adminSecurity : [],
  ...(options.parameters ? { parameters: options.parameters } : {}),
  ...(options.request ? { requestBody: body(options.request) } : {}),
  responses: {
    [options.status ?? 200]: {
      description: "Success",
      content: json(envelope(response)),
    },
    ...errors,
  },
});
const workspacePath = "/api/admin/workspaces/{workspaceSlug}";
const ws = pathParam("workspaceSlug");
const formParams = [ws, pathParam("formId")];
const submissionParams = [ws, pathParam("submissionId")];
const values = {
  type: "object",
  maxProperties: 100,
  additionalProperties: { type: ["string", "number", "boolean"] },
};
const draftMutation = schema(
  z
    .object({ expectedRevision: z.iso.datetime(), schema: formSchemaV1Schema })
    .strict(),
);

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Form Forge product API",
    version: "1.0.0",
    description:
      "Public submissions and workspace product operations. Admin access uses the existing NextAuth session; owner/editor/viewer permissions are enforced by each service. OAuth callbacks, scheduler and internal test controls are outside this document. MCP transport is documented separately in README.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "next-auth.session-token",
      },
      secureSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-next-auth.session-token",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
              fieldErrors: {
                type: "object",
                additionalProperties: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
      FormSchema: schema(formSchemaV1Schema),
      SubmissionRequest: schema(submissionRequestSchema),
      FormPolicyMutation: schema(formPolicyMutationSchema),
      StatusMutation: schema(submissionStatusMutationSchema),
      SubmissionDeletion: schema(submissionDeletionSchema),
      SubmissionRow: {
        type: "object",
        required: [
          "id",
          "formId",
          "formName",
          "createdAt",
          "versionNumber",
          "deliveryStatus",
          "processingStatus",
          "normalizedValues",
        ],
        properties: {
          id: uuid,
          formId: uuid,
          formName: { type: "string" },
          createdAt: timestamp,
          versionNumber: { type: "integer" },
          deliveryStatus: {
            enum: ["pending", "processing", "succeeded", "failed"],
          },
          processingStatus: { enum: ["new", "processed"] },
          normalizedValues: values,
        },
      },
      Acceptance: {
        type: "object",
        required: ["duplicate", "status", "submissionId"],
        properties: {
          duplicate: { type: "boolean" },
          status: { const: "accepted" },
          submissionId: uuid,
        },
      },
    },
  },
  paths: {
    "/api/forms/{slug}": {
      get: operation(
        "getPublishedForm",
        "Current immutable schema and live privacy/intake policy",
        {
          type: "object",
          required: ["form", "intake", "schema", "versionId", "versionNumber"],
          properties: {
            form: {
              type: "object",
              required: ["id", "slug", "name", "collectMetadata"],
              properties: {
                id: uuid,
                name: { type: "string" },
                slug: { type: "string" },
                collectMetadata: { type: "boolean" },
              },
            },
            intake: {
              type: "object",
              required: ["closed", "closesAt", "message"],
              properties: {
                closed: { type: "boolean" },
                closesAt: { type: ["string", "null"], format: "date-time" },
                message: { type: "string" },
              },
            },
            schema: ref("FormSchema"),
            versionId: uuid,
            versionNumber: { type: "integer" },
          },
        },
        { parameters: [pathParam("slug")] },
      ),
    },
    "/api/forms/{slug}/submit": {
      post: {
        ...operation(
          "submitResponse",
          "Accept an immutable response; current intake and metadata policy applies to every version",
          ref("Acceptance"),
          {
            status: 201,
            request: ref("SubmissionRequest"),
            parameters: [
              pathParam("slug"),
              {
                name: "Idempotency-Key",
                in: "header",
                required: true,
                schema: { type: "string", minLength: 1, maxLength: 200 },
                description:
                  "Same key and immutable values/version replays a success without consuming another place. After deletion a keyed hash blocks reuse for 30 days. After expiry a retry is a new submission.",
              },
            ],
          },
        ),
        responses: {
          ...errors,
          201: {
            description: "New response accepted",
            content: json(envelope(ref("Acceptance"))),
          },
          200: {
            description: "Idempotent replay of an existing response",
            content: json(envelope(ref("Acceptance"))),
          },
        },
      },
    },
    [`${workspacePath}/forms`]: {
      get: operation(
        "listForms",
        "List active workspace forms (viewer+)",
        { type: "array", items: object },
        { admin: true, parameters: [ws] },
      ),
      post: operation(
        "createForm",
        "Create a form with optional metadata disabled (editor+)",
        object,
        {
          admin: true,
          status: 201,
          parameters: [ws],
          request: schema(
            z.object({ name: z.string().trim().min(1).max(160) }).strict(),
          ),
        },
      ),
    },
    [`${workspacePath}/forms/{formId}`]: {
      delete: operation(
        "archiveForm",
        "Archive without erasing data (editor+)",
        object,
        { admin: true, parameters: formParams },
      ),
    },
    [`${workspacePath}/forms/{formId}/draft`]: {
      put: operation("saveDraft", "Save an editable draft (editor+)", object, {
        admin: true,
        parameters: formParams,
        request: draftMutation,
      }),
    },
    [`${workspacePath}/forms/{formId}/publish`]: {
      post: operation(
        "publishForm",
        "Publish an immutable version (editor+)",
        object,
        {
          admin: true,
          parameters: formParams,
          status: 201,
          request: {
            oneOf: [
              draftMutation,
              schema(z.object({ expectedRevision: z.iso.datetime() }).strict()),
            ],
          },
        },
      ),
    },
    [`${workspacePath}/forms/{formId}/restore`]: {
      post: operation(
        "restoreArchivedForm",
        "Restore an archived form (editor+)",
        object,
        { admin: true, parameters: formParams },
      ),
    },
    [`${workspacePath}/forms/{formId}/permanent`]: {
      delete: operation(
        "deleteArchivedForm",
        "Permanently delete an archived form after name confirmation (owner)",
        object,
        {
          admin: true,
          parameters: formParams,
          request: schema(
            z.object({ confirmation: z.string().min(1).max(160) }).strict(),
          ),
        },
      ),
    },
    [`${workspacePath}/forms/{formId}/policy`]: {
      put: operation(
        "updateFormPolicy",
        "Update live intake/privacy policy without republishing (editor+)",
        object,
        {
          admin: true,
          parameters: formParams,
          request: ref("FormPolicyMutation"),
        },
      ),
    },
    [`${workspacePath}/submissions`]: {
      get: operation(
        "listSubmissions",
        "Cursor page of responses (viewer+); from inclusive, until exclusive, search words 2–100 characters",
        {
          type: "object",
          required: ["data", "nextCursor"],
          properties: {
            data: { type: "array", maxItems: 100, items: ref("SubmissionRow") },
            nextCursor: { type: ["string", "null"] },
          },
        },
        {
          admin: true,
          parameters: [ws, ...queryParams(submissionListQuerySchema)],
        },
      ),
    },
    [`${workspacePath}/submissions/export`]: {
      get: {
        operationId: "exportSubmissions",
        summary:
          "CSV with the same filters, up to 10,000 rows / 500 answer fields; formula prefixes escaped (viewer+)",
        security: adminSecurity,
        parameters: [ws, ...queryParams(submissionFilterSchema)],
        responses: {
          200: {
            description:
              "CSV snapshot; delivery and processing statuses frozen before streaming",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          ...errors,
        },
      },
    },
    [`${workspacePath}/submissions/{submissionId}`]: {
      get: operation(
        "getSubmission",
        "Read original values/version and bounded delivery history (viewer+)",
        object,
        { admin: true, parameters: submissionParams },
      ),
      patch: operation(
        "updateSubmissionStatus",
        "Change new/processed status without editing values or version (editor+)",
        object,
        {
          admin: true,
          parameters: submissionParams,
          request: ref("StatusMutation"),
        },
      ),
      delete: operation(
        "deleteSubmission",
        "Delete response and associated history/work after ID confirmation (owner); places and quotas remain consumed",
        object,
        {
          admin: true,
          parameters: submissionParams,
          request: ref("SubmissionDeletion"),
        },
      ),
    },
  },
};
