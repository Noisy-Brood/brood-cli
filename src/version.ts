import { readFileSync } from "node:fs";

/**
 * The CLI's version, from its own manifest, so the two cannot differ. Read
 * beside the module rather than imported: the published package compiles
 * src/ to dist/, and a JSON import from above src/ would sit outside what
 * is compiled; one level up is the manifest from either.
 */
export const VERSION: string = (() => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  )
    throw new Error("the CLI's package.json names no version");
  return manifest.version;
})();
