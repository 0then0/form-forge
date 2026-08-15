type ApiErrorBody = {
  fieldErrors?: Record<string, string[]>;
  message?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const parseError = (value: unknown): ApiErrorBody | undefined => {
  if (!isRecord(value)) return undefined;
  const message = typeof value.message === "string" ? value.message : undefined;
  const rawFieldErrors = value.fieldErrors;
  const fieldErrors = isRecord(rawFieldErrors)
    ? Object.fromEntries(
        Object.entries(rawFieldErrors).flatMap(([key, messages]) =>
          isStringArray(messages) ? [[key, messages]] : [],
        ),
      )
    : undefined;
  return {
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
    ...(message === undefined ? {} : { message }),
  };
};

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export const readApiData = async <T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> => {
  let body: unknown;
  try {
    const text = await response.text();
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    throw new ClientApiError(fallbackMessage);
  }

  const envelope = isRecord(body) ? body : undefined;
  const error = parseError(envelope?.error);
  if (!response.ok || envelope === undefined || !("data" in envelope)) {
    throw new ClientApiError(
      error?.message ?? fallbackMessage,
      error?.fieldErrors,
    );
  }

  // API route handlers own runtime DTO validation. This single adapter keeps
  // untrusted envelope parsing out of individual UI components.
  return envelope.data as T;
};
