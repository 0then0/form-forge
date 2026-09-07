import type { FormSchemaV1 } from "@form-forge/form-schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HostedForm } from "./hosted-form";

const schema: FormSchemaV1 = {
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "name",
      label: "Name",
      required: true,
      type: "shortText",
      width: "full",
    },
  ],
  schemaVersion: 1,
  settings: {
    submitLabel: "Submit",
    successMessage: "Received",
    successTitle: "Thanks",
  },
  title: "Contact",
};

describe("HostedForm", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("submits without visitor metadata when localStorage is unavailable", async () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { submissionId: "submission" } }), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await screen.findByRole("status");
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      context: { utm: {} },
      values: { name: "Ada" },
      versionId: "version-id",
    });
    expect(JSON.parse(String(request.body)).context).not.toHaveProperty(
      "visitorId",
    );
  });

  it("shows a stable message for a non-JSON gateway error", async () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Bad gateway</html>", { status: 502 }),
        ),
    );
    const user = userEvent.setup();
    render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("Your response could not be submitted"),
    ).toBeVisible();
  });

  it("links the hosted-form attribution to the project repository", () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );

    expect(screen.getByRole("link", { name: "Form Forge" })).toHaveAttribute(
      "href",
      "https://github.com/0then0/form-forge",
    );
  });

  it("reuses the idempotency key after an unsuccessful submission", async () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Gateway error", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { submissionId: "submission" } }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const first = render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Your response could not be submitted");
    first.unmount();

    render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("status");

    const firstRequest = fetch.mock.calls[0]?.[1] as RequestInit;
    const secondRequest = fetch.mock.calls[1]?.[1] as RequestInit;
    const firstHeaders = firstRequest.headers as Record<string, string>;
    const secondHeaders = secondRequest.headers as Record<string, string>;
    expect(firstHeaders).toMatchObject({
      "Idempotency-Key": expect.any(String),
    });
    expect(secondHeaders).toMatchObject({
      "Idempotency-Key": firstHeaders["Idempotency-Key"],
    });
  });

  it("creates a new idempotency key after a successful submission", async () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data: { submissionId: "submission" } }), {
          headers: { "Content-Type": "application/json" },
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const first = render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("status");
    first.unmount();

    render(
      <HostedForm schema={schema} slug="contact" versionId="version-id" />,
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Ada");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("status");

    const firstRequest = fetch.mock.calls[0]?.[1] as RequestInit;
    const secondRequest = fetch.mock.calls[1]?.[1] as RequestInit;
    const firstHeaders = firstRequest.headers as Record<string, string>;
    const secondHeaders = secondRequest.headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).not.toBe(
      firstHeaders["Idempotency-Key"],
    );
  });
});
