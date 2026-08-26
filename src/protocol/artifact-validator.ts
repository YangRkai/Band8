import { ProtocolValidationError } from "./validator.js";

type Document = Record<string, any>;

function fail(message: string): never {
  throw new ProtocolValidationError(message);
}

export function validateArtifactSemantics(document: Document): void {
  const relativePath = document.relative_path as string;
  if (
    relativePath.includes("\\")
    || /^[A-Za-z]:/u.test(relativePath)
    || relativePath.startsWith("/")
    || relativePath.includes("://")
  ) {
    fail("artifact relative_path is unsafe");
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    fail("artifact relative_path is unsafe");
  }
}
