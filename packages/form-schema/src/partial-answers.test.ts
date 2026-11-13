import { describe, expect, it } from "vitest";

import { MAX_EMAIL_LENGTH, MAX_SUBMISSION_TEXT_LENGTH } from "./limits";
import { defaultFormSchema } from "./schema";
import { sanitizePartialAnswers } from "./submission";
import type { FormField, FormSchemaV1 } from "./types";

const field = (
  key: string,
): Pick<FormField, "id" | "key" | "label" | "required" | "width"> => ({
  id: crypto.randomUUID(),
  key,
  label: key,
  required: true,
  width: "full",
});
const schema: FormSchemaV1 = {
  ...defaultFormSchema(),
  fields: [
    {
      ...field("short"),
      type: "shortText",
      validation: { minLength: 5, maxLength: 20 },
    },
    { ...field("long"), type: "longText" },
    { ...field("email"), type: "email" },
    { ...field("number"), type: "number", validation: { min: 0 } },
    {
      ...field("select"),
      type: "select",
      options: [{ label: "Yes", value: "yes" }],
    },
    { ...field("checkbox"), type: "checkbox" },
    { ...field("date"), type: "date", validation: { min: "2026-01-01" } },
  ],
};

describe("sanitizePartialAnswers", () => {
  it("keeps incomplete input and typed values for every supported field", () => {
    const answers = {
      short: "a",
      long: " unfinished ",
      email: "a@",
      number: "-",
      select: "",
      checkbox: false,
      date: "2025-01-01",
    };
    expect(sanitizePartialAnswers(schema, answers)).toEqual({
      answers,
      droppedKeys: [],
    });
    expect(
      sanitizePartialAnswers(schema, {
        number: 42,
        select: "yes",
        checkbox: true,
      }).answers,
    ).toEqual({ number: 42, select: "yes", checkbox: true });
  });

  it("handles the default empty schema and partial forms with missing required fields", () => {
    const defaults = defaultFormSchema();
    expect(sanitizePartialAnswers(defaults, {})).toEqual({
      answers: {},
      droppedKeys: [],
    });
    expect(sanitizePartialAnswers(defaults, { old: "partial" })).toEqual({
      answers: {},
      droppedKeys: ["old"],
    });
    expect(
      sanitizePartialAnswers(schema, { short: "partial" }).answers,
    ).toEqual({ short: "partial" });
  });

  it("drops unknown keys, invalid types, oversized values and unsupported options", () => {
    expect(
      sanitizePartialAnswers(schema, {
        short: "a".repeat(21),
        long: [],
        email: "a".repeat(MAX_EMAIL_LENGTH + 1),
        number: Number.NaN,
        select: "other",
        checkbox: "true",
        date: "2026-02-30",
        unknown: "secret",
      }),
    ).toEqual({
      answers: {},
      droppedKeys: [
        "short",
        "long",
        "email",
        "number",
        "select",
        "checkbox",
        "date",
        "unknown",
      ],
    });
    expect(sanitizePartialAnswers(schema, null)).toEqual({
      answers: {},
      droppedKeys: ["_root"],
    });
    expect(sanitizePartialAnswers(schema, [])).toEqual({
      answers: {},
      droppedKeys: ["_root"],
    });
  });

  it("uses normalized valid controllers and removes hidden values and cascades", () => {
    const conditional: FormSchemaV1 = {
      ...schema,
      fields: [
        { ...field("number"), type: "number" },
        {
          ...field("note"),
          type: "shortText",
          visibility: { fieldKey: "number", operator: "equals", value: 18 },
        },
        {
          ...field("detail"),
          type: "longText",
          visibility: { fieldKey: "note", operator: "equals", value: "yes" },
        },
      ],
    };
    expect(
      sanitizePartialAnswers(conditional, {
        number: "18",
        note: "yes",
        detail: "visible",
      }).answers,
    ).toEqual({ number: "18", note: "yes", detail: "visible" });
    expect(
      sanitizePartialAnswers(conditional, {
        number: "17",
        note: "yes",
        detail: "hidden",
      }),
    ).toEqual({ answers: { number: "17" }, droppedKeys: ["note", "detail"] });
    expect(
      sanitizePartialAnswers(conditional, { number: "-", note: "yes" }).answers,
    ).toEqual({ number: "-" });
  });

  it("bounds aggregate partial text", () => {
    const bounded = {
      ...schema,
      fields: Array.from(
        { length: 8 },
        (_, index): FormField => ({
          ...field(`text${index}`),
          type: "longText",
        }),
      ),
    };
    const result = sanitizePartialAnswers(
      bounded,
      Object.fromEntries(
        bounded.fields.map(({ key }) => [key, "x".repeat(10_000)]),
      ),
    );
    expect(
      Object.values(result.answers).reduce<number>(
        (sum, value) => sum + String(value).length,
        0,
      ),
    ).toBeLessThanOrEqual(MAX_SUBMISSION_TEXT_LENGTH);
    expect(result.droppedKeys).toHaveLength(2);
  });
});
