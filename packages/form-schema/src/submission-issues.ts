import { z } from "zod";

import { DEFAULT_FORM_LANGUAGE, type FormLanguage } from "./types";

const simpleCode = z.enum([
  "REQUIRED",
  "EXPECTED_TEXT",
  "INVALID_FORMAT",
  "INVALID_EMAIL",
  "INVALID_NUMBER",
  "INVALID_OPTION",
  "EXPECTED_CHECKBOX",
  "MUST_BE_CHECKED",
  "INVALID_DATE",
  "UNKNOWN_FIELD",
]);
const numericCode = z.enum([
  "MIN_LENGTH",
  "MAX_LENGTH",
  "MIN_NUMBER",
  "MAX_NUMBER",
  "MAX_FIELDS",
  "MAX_TOTAL_LENGTH",
]);
const dateCode = z.enum(["MIN_DATE", "MAX_DATE"]);

const submissionIssueSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: simpleCode }),
  z.strictObject({
    code: numericCode,
    params: z.strictObject({ limit: z.number() }),
  }),
  z.strictObject({
    code: dateCode,
    params: z.strictObject({ date: z.iso.date() }),
  }),
]);

export const submissionFieldIssuesSchema = z.record(
  z.string(),
  z.array(submissionIssueSchema).min(1),
);
export type SubmissionIssue = z.infer<typeof submissionIssueSchema>;

type IssueMessages = Record<z.infer<typeof simpleCode>, string> &
  Record<z.infer<typeof numericCode>, (limit: number) => string> &
  Record<z.infer<typeof dateCode>, (date: string) => string>;

const russianDate = (date: string) => date.split("-").reverse().join(".");

const messages: Record<FormLanguage, IssueMessages> = {
  en: {
    REQUIRED: "This field is required",
    EXPECTED_TEXT: "Expected text",
    INVALID_FORMAT: "Invalid format",
    INVALID_EMAIL: "Enter a valid email address",
    INVALID_NUMBER: "Enter a valid number",
    INVALID_OPTION: "Select a valid option",
    EXPECTED_CHECKBOX: "Expected a checkbox value",
    MUST_BE_CHECKED: "This field must be checked",
    INVALID_DATE: "Enter a valid date",
    UNKNOWN_FIELD: "Unknown field",
    MIN_LENGTH: (limit) => `Must contain at least ${limit} characters`,
    MAX_LENGTH: (limit) => `Must contain at most ${limit} characters`,
    MIN_NUMBER: (limit) => `Must be at least ${limit}`,
    MAX_NUMBER: (limit) => `Must be at most ${limit}`,
    MAX_FIELDS: (limit) => `A submission can contain at most ${limit} fields`,
    MAX_TOTAL_LENGTH: (limit) =>
      `Submission text can contain at most ${limit} characters`,
    MIN_DATE: (date) => `Date must be on or after ${date}`,
    MAX_DATE: (date) => `Date must be on or before ${date}`,
  },
  ru: {
    REQUIRED: "Заполните это поле",
    EXPECTED_TEXT: "Введите текст",
    INVALID_FORMAT: "Неверный формат",
    INVALID_EMAIL: "Введите корректный адрес электронной почты",
    INVALID_NUMBER: "Введите корректное число",
    INVALID_OPTION: "Выберите вариант из списка",
    EXPECTED_CHECKBOX: "Укажите, отмечен ли флажок",
    MUST_BE_CHECKED: "Установите флажок",
    INVALID_DATE: "Введите корректную дату",
    UNKNOWN_FIELD: "Форма не содержит такого поля",
    MIN_LENGTH: (limit) => `Минимальное число символов: ${limit}`,
    MAX_LENGTH: (limit) => `Максимальное число символов: ${limit}`,
    MIN_NUMBER: (limit) => `Введите число не меньше ${limit}`,
    MAX_NUMBER: (limit) => `Введите число не больше ${limit}`,
    MAX_FIELDS: (limit) => `Максимальное число полей в ответе: ${limit}`,
    MAX_TOTAL_LENGTH: (limit) =>
      `Максимальное число символов во всём ответе: ${limit}`,
    MIN_DATE: (date) => `Укажите дату не раньше ${russianDate(date)}`,
    MAX_DATE: (date) => `Укажите дату не позже ${russianDate(date)}`,
  },
};

export const formatSubmissionIssue = (
  issue: SubmissionIssue,
  language: FormLanguage = DEFAULT_FORM_LANGUAGE,
): string => {
  const copy = messages[language];
  switch (issue.code) {
    case "MIN_LENGTH":
    case "MAX_LENGTH":
    case "MIN_NUMBER":
    case "MAX_NUMBER":
    case "MAX_FIELDS":
    case "MAX_TOTAL_LENGTH":
      return copy[issue.code](issue.params.limit);
    case "MIN_DATE":
    case "MAX_DATE":
      return copy[issue.code](issue.params.date);
    default:
      return copy[issue.code];
  }
};
