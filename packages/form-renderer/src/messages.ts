import type { FormLanguage } from "@form-forge/form-schema";

export const rendererMessages = {
  en: {
    selectOption: "Select an option",
    errorSummary: "Please correct the following:",
    submitting: "Submitting…",
    submissionFailed: "Your response could not be submitted",
  },
  ru: {
    selectOption: "Выберите вариант",
    errorSummary: "Исправьте ошибки:",
    submitting: "Отправка…",
    submissionFailed: "Не удалось отправить ответ. Попробуйте ещё раз.",
  },
} satisfies Record<FormLanguage, Record<string, string>>;
