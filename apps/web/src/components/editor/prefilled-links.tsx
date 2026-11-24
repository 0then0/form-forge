"use client";

import type { FormSchemaV1 } from "@form-forge/form-schema";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
} from "@form-forge/ui";
import { Copy } from "lucide-react";
import { useId, useState } from "react";

import { createPrefilledUrl, getPrefillFields } from "@/lib/prefill";

export const PrefilledLinks = ({
  publicUrl,
  schema,
}: {
  publicUrl: string;
  schema: FormSchemaV1;
}) => {
  const id = useId();
  const fields = getPrefillFields(schema);
  const [fieldKey, setFieldKey] = useState(fields[0]?.key);
  const [value, setValue] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<{
    url: string;
    copied: boolean;
  }>();
  const field = fields.find(({ key }) => key === fieldKey);
  if (!field) return null;

  const url = value ? createPrefilledUrl(publicUrl, field.key, value) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback({ url, copied: true });
    } catch {
      setCopyFeedback({ url, copied: false });
    }
  };
  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold">Prefilled links</h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose an option from the published version. Its value is visible in
          the URL. Respondents can change their answer.
        </p>
      </div>
      <CardContent className="space-y-3">
        {fields.length > 1 ? (
          <div className="space-y-1">
            <Label htmlFor={`${id}-field`}>Published field</Label>
            <Select
              id={`${id}-field`}
              value={field.key}
              onChange={(event) => {
                setFieldKey(event.currentTarget.value);
                setValue("");
                setCopyFeedback(undefined);
              }}
            >
              {fields.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label} ({key})
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${id}-option`}>{field.label} option</Label>
          <Select
            id={`${id}-option`}
            value={value}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setCopyFeedback(undefined);
            }}
          >
            <option value="">Choose an option</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {field.options.some(
                  (other) => other !== option && other.label === option.label,
                )
                  ? `${option.label} (${option.value})`
                  : option.label}
              </option>
            ))}
          </Select>
        </div>
        {url ? (
          <div className="space-y-1">
            <Label htmlFor={`${id}-link`}>Link</Label>
            <Input
              id={`${id}-link`}
              value={url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={!url}
          onClick={() => void copy()}
        >
          <Copy className="size-4" /> Copy link
        </Button>
        {copyFeedback?.url === url ? (
          <p className="text-sm" role="status">
            {copyFeedback.copied
              ? "Link copied"
              : "Clipboard unavailable. Select the link to copy it manually."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
