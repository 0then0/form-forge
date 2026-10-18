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
});
