// @vitest-environment node
import { expect, test } from "vitest";
import { openApiDocument } from "./openapi";

test("publishes reusable JSON Schemas and actual product routes without weakening session authorization", () => {
  expect(openApiDocument.openapi).toBe("3.1.0");
  const spec = JSON.parse(JSON.stringify(openApiDocument));
  expect(spec.components.schemas.SubmissionRequest.required).toContain(
    "versionId",
  );
  expect(
    spec.components.schemas.FormPolicyMutation.properties.policy.properties
      .collectMetadata.type,
  ).toBe("boolean");
  expect(spec.paths["/api/forms/{slug}/submit"].post.security).toEqual([]);
  const settings = spec.components.schemas.FormSchema.properties.settings;
  expect(settings.properties.language).toMatchObject({
    enum: ["en", "ru"],
    default: "en",
  });
  expect(settings.required).not.toContain("language");
  expect(
    spec.components.schemas.Error.properties.error.properties,
  ).toMatchObject({
    fieldErrors: { type: "object" },
    fieldIssues: { type: "object" },
    closedIntake: { required: ["customMessage"] },
  });
  expect(spec.paths["/api/forms/{slug}/submit"].post.responses).toHaveProperty(
    "200",
  );
  expect(spec.paths["/api/forms/{slug}/submit"].post.responses).toHaveProperty(
    "201",
  );
  for (const [path, methods] of Object.entries(spec.paths)) {
    if (path.startsWith("/api/admin/"))
      for (const method of Object.values(
        methods as Record<string, { security: unknown }>,
      ))
        expect(method.security).toEqual([
          { session: [] },
          { secureSession: [] },
        ]);
  }
  expect(spec.components.schemas.FormTemplate).toMatchObject({
    additionalProperties: false,
    properties: {
      format: { const: "form-forge.form-template" },
      formatVersion: { const: 1 },
    },
  });
  expect(
    spec.paths["/api/admin/workspaces/{workspaceSlug}/forms/import"].post
      .parameters,
  ).toContainEqual(
    expect.objectContaining({ name: "digest", in: "query", required: true }),
  );
  const list =
    spec.paths["/api/admin/workspaces/{workspaceSlug}/submissions"].get
      .parameters;
  const csv =
    spec.paths["/api/admin/workspaces/{workspaceSlug}/submissions/export"].get
      .parameters;
  expect(
    list.filter(
      (param: { name: string }) => !["cursor", "limit"].includes(param.name),
    ),
  ).toEqual(csv);
  const markProcessed =
    spec.paths[
      "/api/admin/workspaces/{workspaceSlug}/submissions/mark-processed"
    ].post;
  expect(markProcessed.requestBody.content["application/json"].schema).toEqual({
    $ref: "#/components/schemas/MarkSubmissionsProcessed",
  });
  expect(markProcessed.responses).toHaveProperty("409");
  expect(spec.components.schemas.MarkSubmissionsProcessed).toMatchObject({
    required: ["formId", "submissionIds"],
    properties: {
      formId: { format: "uuid" },
      submissionIds: {
        minItems: 1,
        maxItems: list.find((param: { name: string }) => param.name === "limit")
          .schema.maximum,
        uniqueItems: true,
        items: { format: "uuid" },
      },
    },
  });
});
