type Document = Record<string, any>;
type JsonDto = Document | null;

export class ApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function sessionToken(): string {
  const token = document.querySelector<HTMLMetaElement>('meta[name="band8-session"]')?.content;
  if (token === undefined || token.length === 0) throw new ApiError("LOCAL_SESSION_MISSING", "Reload Band8 from the local server.");
  return token;
}

async function parse(response: Response): Promise<JsonDto> {
  const value = await response.json() as JsonDto;
  if (!response.ok) {
    const error = value ?? {};
    throw new ApiError(String(error.code ?? "REQUEST_REJECTED"), String(error.message ?? "Request rejected"));
  }
  return value;
}

export async function getJson(path: string): Promise<JsonDto> {
  return await parse(await fetch(path, { headers: { accept: "application/json" } }));
}

export async function postJson(path: string, value: Document): Promise<Document> {
  const response = await parse(await postResponse(path, value));
  if (response === null) throw new ApiError("INVALID_RESPONSE", "Band8 returned an empty mutation response.");
  return response;
}

export async function postResponse(path: string, value: Document): Promise<Response> {
  return await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-band8-session": sessionToken(),
    },
    body: JSON.stringify(value),
  });
}
