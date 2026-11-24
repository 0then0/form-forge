import {
  defaultFormSchema,
  formSchemaV1Schema,
  type SelectField,
} from "@form-forge/form-schema";
import { describe, expect, it } from "vitest";

import { createPrefilledUrl, resolvePrefill } from "./prefill";

const specialValue = "Встреча 🗓 + Q&A #1: утро";
const meeting: SelectField = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "meeting",
  label: "Meeting",
  required: false,
  width: "full",
  type: "select",
  allowPrefill: true,
  options: [{ label: "Workshop", value: specialValue }],
};
const schema = formSchemaV1Schema.parse({
  ...defaultFormSchema(),
  fields: [
    meeting,
    {
      ...meeting,
      id: "22222222-2222-4222-8222-222222222222",
      key: "conditional",
      visibility: {
        fieldKey: "meeting",
        operator: "equals",
        value: specialValue,
      },
    },
  ],
});

describe("prefilled links", () => {
  it("round-trips a saved option value and keeps other URL parameters", () => {
    const url = new URL(
      createPrefilledUrl(
        "https://forms.example.org/f/registration?embed=1",
        "meeting",
        specialValue,
      ),
    );
    expect(url.hash).toBe("");
    expect(url.searchParams.get("embed")).toBe("1");
    expect(
      resolvePrefill(schema, url.searchParams.get("prefill") ?? undefined),
    ).toEqual({ fieldKey: "meeting", value: specialValue });
  });

  it.each(
    [
      undefined,
      ["meeting:removed", `meeting:${specialValue}`],
      "meeting",
      "meeting:",
      "meeting:Workshop",
      "meeting:removed",
      `unknown:${specialValue}`,
      `conditional:${specialValue}`,
      `${"a".repeat(65)}:${specialValue}`,
      `meeting:${"a".repeat(121)}`,
    ].map((parameter) => ({ parameter })),
  )("ignores an invalid parameter $parameter", ({ parameter }) => {
    expect(resolvePrefill(schema, parameter)).toBeUndefined();
  });

  it.each([undefined, false])(
    "ignores the option when permission is %s",
    (allowPrefill) => {
      expect(
        resolvePrefill(
          { ...schema, fields: [{ ...meeting, allowPrefill }] },
          `meeting:${specialValue}`,
        ),
      ).toBeUndefined();
    },
  );

  it("ignores an option hidden by the initial unchecked checkbox", () => {
    const conditionalSchema = formSchemaV1Schema.parse({
      ...schema,
      fields: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          key: "more",
          label: "More",
          required: false,
          width: "full",
          type: "checkbox",
        },
        {
          ...meeting,
          visibility: { fieldKey: "more", operator: "notEquals", value: false },
        },
      ],
    });
    expect(
      resolvePrefill(conditionalSchema, `meeting:${specialValue}`),
    ).toBeUndefined();
  });
});
