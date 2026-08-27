export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function safeError(error: unknown): { status: number; body: { code: string; message: string } } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : "Runtime request failed";
  if (/UNSUPPORTED_RUNTIME_PRIMITIVE/iu.test(message)) {
    return { status: 400, body: { code: "UNSUPPORTED_RUNTIME_PRIMITIVE", message: "This activity primitive is not supported by the current Runtime." } };
  }
  if (/continuation|checkpoint/iu.test(message)) {
    return { status: 400, body: { code: "CONTINUATION_REJECTED", message: "This package does not match the current Coach checkpoint." } };
  }
  if (/learning timezone|time zone|iana/iu.test(message)) {
    return { status: 400, body: { code: "LEARNING_TIMEZONE_REJECTED", message: "The learning timezone is not a supported IANA timezone." } };
  }
  return { status: 400, body: { code: "RUNTIME_REJECTED", message: "The Runtime rejected this request." } };
}
