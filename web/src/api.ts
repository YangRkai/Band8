import type {
  HistoryPageDto,
  ProductApiGetMap,
  ProductApiMutationMap,
} from "../../src/product-api/dto.js";

type GetRoute = keyof ProductApiGetMap;
type HistoryRoute = `/api/v1/history?${string}`;
type GetResponse<Path extends GetRoute | HistoryRoute> = Path extends HistoryRoute
  ? HistoryPageDto
  : Path extends GetRoute ? ProductApiGetMap[Path] : never;
type MutationRoute = keyof ProductApiMutationMap;

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

function errorValue(value: unknown, key: "code" | "message", fallback: string): string {
  if (value === null || typeof value !== "object" || !(key in value)) return fallback;
  const field = key === "code"
    ? (value as { code?: unknown }).code
    : (value as { message?: unknown }).message;
  return typeof field === "string" ? field : fallback;
}

async function parse<ResponseDto>(response: Response): Promise<ResponseDto> {
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new ApiError(
      errorValue(value, "code", "REQUEST_REJECTED"),
      errorValue(value, "message", "Request rejected"),
    );
  }
  return value as ResponseDto;
}

export async function getJson<Path extends GetRoute | HistoryRoute>(path: Path): Promise<GetResponse<Path>> {
  return await parse<GetResponse<Path>>(await fetch(path, { headers: { accept: "application/json" } }));
}

export async function postJson<Path extends MutationRoute>(
  path: Path,
  value: ProductApiMutationMap[Path]["request"],
): Promise<ProductApiMutationMap[Path]["response"]> {
  return await parse<ProductApiMutationMap[Path]["response"]>(await postResponse(path, value));
}

export async function postResponse<Path extends MutationRoute>(
  path: Path,
  value: ProductApiMutationMap[Path]["request"],
): Promise<Response> {
  return await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-band8-session": sessionToken(),
    },
    body: JSON.stringify(value),
  });
}
