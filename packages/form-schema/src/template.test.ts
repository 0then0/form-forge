import { describe, expect, it } from "vitest";

import {
  createFormTemplate,
  FORM_TEMPLATE_FORMAT,
  parseFormTemplate,
} from "./template";
import type { FormSchemaV1 } from "./types";

const form: FormSchemaV1 = {
  schemaVersion: 1,
  title: "Event registration",
  description: "Tell us about your visit.",
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "ticket",
      label: "Ticket",
      required: true,
      type: "select",
      width: "full",
      options: [
        { label: "Workshop", value: "workshop" },
        { label: "Conference", value: "conference" },
        { label: "Both", value: "both" },
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      key: "workshop_topic",
      label: "Workshop topic",
      required: false,
      type: "shortText",
      width: "half",
      webhookKey: "topic",
      visibility: { fieldKey: "ticket", operator: "equals", value: "workshop" },
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      key: "email",
      label: "Email",
      required: true,
      type: "email",
      width: "half",
    },
  ],
  settings: {
    language: "ru",
    submitLabel: "Register",
    successTitle: "See you there",
    successMessage: "Your registration has been received.",
  },
};

const roundTrip = (value: unknown) =>
  parseFormTemplate(JSON.parse(JSON.stringify(value)));

describe("form templates", () => {
  it("contains only the format identifier, format version and definition", () => {
    const template = createFormTemplate(form);
    expect(Object.keys(template).sort()).toEqual([
      "form",
      "format",
      "formatVersion",
    ]);
    expect(template).toMatchObject({
      format: FORM_TEMPLATE_FORMAT,
      formatVersion: 1,
      form: { schemaVersion: 1 },
    });
  });

  it("round-trips language, identifiers, order, options and conditional references", () => {
    const result = roundTrip(createFormTemplate(form));
    expect(result).toEqual({
      success: true,
      template: createFormTemplate(form),
    });
    if (!result.success) return;
    expect(result.template.form).toEqual(form);
    expect(result.template.form.fields.map((field) => field.id)).toEqual(
      form.fields.map((field) => field.id),
    );
  });

  it.each([
    [null, "This file is not a Form Forge form template"],
    [[], "This file is not a Form Forge form template"],
    [{ form }, "This file is not a Form Forge form template"],
    [
      { format: "other.template", formatVersion: 1, form },
      "This file is not a Form Forge form template",
    ],
    [
      { format: FORM_TEMPLATE_FORMAT, formatVersion: 2, form },
      "Template format version 2 is not supported. Supported versions: 1.",
    ],
    [
      { format: FORM_TEMPLATE_FORMAT, formatVersion: "1", form },
      "Template format version missing or invalid is not supported. Supported versions: 1.",
    ],
    [
      {
        format: FORM_TEMPLATE_FORMAT,
        formatVersion: 1,
        form: { ...form, schemaVersion: 2 },
      },
      "Form schema version 2 is not supported. Supported versions: 1.",
    ],
  ])("rejects unsupported envelopes and versions", (value, message) => {
    expect(parseFormTemplate(value)).toEqual({
      success: false,
      message,
      issues: [],
    });
  });

  it("rejects extra envelope data such as instance identifiers", () => {
    const result = roundTrip({
      ...createFormTemplate(form),
      workspaceId: "44444444-4444-4444-8444-444444444444",
    });
    expect(result).toMatchObject({
      success: false,
      issues: [
        { path: "_root", message: expect.stringMatching(/workspaceId/) },
      ],
    });
  });

  it("rejects broken conditional references and duplicate options", () => {
    const [ticket, topic, email] = form.fields;
    if (ticket?.type !== "select" || !topic || !email) throw new Error();
    const broken = createFormTemplate(form) as {
      form: Record<string, unknown>;
    };
    broken.form = {
      ...form,
      fields: [
        {
          ...ticket,
          options: [...ticket.options, { label: "Again", value: "workshop" }],
        },
        {
          ...topic,
          visibility: { fieldKey: "missing", operator: "equals", value: "x" },
        },
        { ...email, visibility: { fieldKey: "email", operator: "isEmpty" } },
      ],
    };
    const result = roundTrip(broken);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          path: "form.fields.0.options",
          message: "Option values must be unique",
        },
        {
          path: "form.fields.1.visibility.fieldKey",
          message: "Visibility must reference an existing field",
        },
        {
          path: "form.fields.2.visibility.fieldKey",
          message: "Visibility can only reference an earlier field",
        },
      ]),
    );
  });
});
