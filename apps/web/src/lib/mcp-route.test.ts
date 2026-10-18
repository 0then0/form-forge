// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { AppError } from "./errors";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  workspace: vi.fn(),
  forms: vi.fn(),
  form: vi.fn(),
  submissions: vi.fn(),
  submission: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({ requireUser: mocks.user }));
vi.mock("@/services/forms", () => ({
  listActiveForms: mocks.forms,
  getFormForViewing: mocks.form,
}));
vi.mock("@/services/submissions", () => ({
  listSubmissions: mocks.submissions,
  getSubmissionDetail: mocks.submission,
}));
import { POST, GET } from "../../app/api/admin/mcp/route";
const request = (message: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/admin/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(message),
  });
const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  ...(params ? { params } : {}),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
});

test("requires an existing session and rejects cross-origin requests on POST and GET", async () => {
  mocks.user.mockRejectedValue(
    new AppError("UNAUTHORIZED", "Authentication is required", 401),
  );
  expect((await POST(request(rpc("tools/list")))).status).toBe(401);
  mocks.user.mockResolvedValue({ id: "user" });
  expect(
    (
      await POST(
        request(rpc("tools/list"), { origin: "https://attacker.example" }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await GET(
        new Request("http://localhost:3000/api/admin/mcp", {
          headers: { origin: "https://attacker.example" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await GET(new Request("http://localhost:3000/api/admin/mcp"))).status,
  ).toBe(405);
});

test("negotiates stateless MCP, acknowledges notifications and advertises read-only tools", async () => {
  const initialized = await POST(
    request(
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ),
  );
  expect((await initialized.json()).result).toMatchObject({
    protocolVersion: "2025-11-25",
    capabilities: { tools: { listChanged: false } },
  });
  expect(initialized.headers.has("mcp-session-id")).toBe(false);
  expect(
    (
      await POST(
        request({ jsonrpc: "2.0", method: "notifications/initialized" }),
      )
    ).status,
  ).toBe(202);
  const result = await (await POST(request(rpc("tools/list")))).json();
  expect(
    result.result.tools.map((tool: { name: string }) => tool.name),
  ).toEqual(["list_forms", "get_form", "list_submissions", "get_submission"]);
  for (const tool of result.result.tools)
    expect(tool.annotations.readOnlyHint).toBe(true);
});

test("validates envelopes, method arguments, bounds and transport headers", async () => {
  expect((await POST(request([rpc("ping")]))).status).toBe(400);
  expect(
    (await POST(request(rpc("ping"), { Accept: "application/json" }))).status,
  ).toBe(406);
  expect(
    (await POST(request(rpc("ping"), { "mcp-protocol-version": "invalid" })))
      .status,
  ).toBe(400);
  expect((await (await POST(request(rpc("unknown")))).json()).error.code).toBe(
    -32601,
  );
  expect(
    (
      await (
        await POST(request(rpc("tools/call", { name: "delete_submission" })))
      ).json()
    ).error.code,
  ).toBe(-32602);
  expect(
    (
      await (
        await POST(
          request(
            rpc("tools/call", {
              name: "list_submissions",
              arguments: { workspaceSlug: "test", limit: 101 },
            }),
          ),
        )
      ).json()
    ).error.code,
  ).toBe(-32602);
  expect(mocks.submissions).not.toHaveBeenCalled();
});

test("delegates all data access to existing authorized services and returns safe tool errors", async () => {
  const args = {
    workspaceSlug: "isolated",
    submissionId: "11111111-1111-4111-8111-111111111111",
  };
  mocks.submission.mockRejectedValue(
    new AppError("NOT_FOUND", "Submission not found", 404),
  );
  const result = await (
    await POST(
      request(rpc("tools/call", { name: "get_submission", arguments: args })),
    )
  ).json();
  expect(mocks.submission).toHaveBeenCalledWith(
    args.workspaceSlug,
    args.submissionId,
  );
  expect(result.result).toEqual({
    isError: true,
    content: [{ type: "text", text: "Submission not found" }],
  });
});
