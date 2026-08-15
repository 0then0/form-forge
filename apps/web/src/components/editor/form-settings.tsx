"use client";

import type { FormSchemaV1 } from "@form-forge/form-schema";
import { Card, CardContent, Input, Label, Textarea } from "@form-forge/ui";
import type { UseFormRegister } from "react-hook-form";

export const FormSettings = ({
  canEdit,
  register,
}: {
  canEdit: boolean;
  register: UseFormRegister<FormSchemaV1>;
}) => (
  <Card>
    <CardContent className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="schema-title">Title</Label>
        <Input id="schema-title" disabled={!canEdit} {...register("title")} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="schema-description">Description</Label>
        <Textarea
          id="schema-description"
          disabled={!canEdit}
          {...register("description")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="submit-label">Submit button</Label>
        <Input
          id="submit-label"
          disabled={!canEdit}
          {...register("settings.submitLabel")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="success-title">Success title</Label>
        <Input
          id="success-title"
          disabled={!canEdit}
          {...register("settings.successTitle")}
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="success-message">Success message</Label>
        <Textarea
          id="success-message"
          disabled={!canEdit}
          {...register("settings.successMessage")}
        />
      </div>
    </CardContent>
  </Card>
);
