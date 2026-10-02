import { describe, expect, it } from "vitest";

/** Every TypeScript file of compiler/, keyed by its path from this folder, as text. */
const SOURCES = import.meta.glob<string>(["./**/*.ts", "!./**/*.d.ts"], {
  eager: true,
  query: "?raw",
  import: "default",
});

/** The packages the compiler runs on. */
const PACKAGES = ["js-yaml", "zod"];

/** What the tests and their support add to the compiler's packages. */
const TEST_PACKAGES = ["vitest"];

/** The scripts run under Node, beside the compiler: they may also use Node's built-in modules. */
const NODE_BUILTIN = /^node:/u;

type Import = { path: string; specifier: string };

/** The module specifiers a file imports from or re-exports. */
function importsOf(path: string, source: string): Import[] {
  return [
    ...source.matchAll(/\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/gmu),
  ].map((match) => ({ path, specifier: match[1] ?? match[2] ?? match[3] ?? "" }));
}

function isTestSupport(path: string): boolean {
  return path.endsWith(".test.ts") || path.startsWith("./testing/");
}

function isScript(path: string): boolean {
  return path.startsWith("./scripts/") && !path.endsWith(".test.ts");
}

/** The folders a relative specifier climbs to from the file's folder, `[]` being compiler/ itself. */
function resolvedFolders({ path, specifier }: Import): string[] | null {
  const folders = path.split("/").slice(1, -1);
  const segments = specifier.split("/");
  const last = segments.at(-1);
  for (const segment of last === "." || last === ".." ? segments : segments.slice(0, -1)) {
    if (segment === "..") {
      if (folders.pop() === undefined) {
        return null;
      }
    } else if (segment !== ".") {
      folders.push(segment);
    }
  }
  return folders;
}

function isAllowed(entry: Import): boolean {
  if (entry.specifier.startsWith(".")) {
    return resolvedFolders(entry) !== null;
  }
  return (
    [...PACKAGES, ...(isTestSupport(entry.path) ? TEST_PACKAGES : [])].includes(entry.specifier) ||
    (isScript(entry.path) && NODE_BUILTIN.test(entry.specifier))
  );
}

const IMPORTS = Object.entries(SOURCES).flatMap(([path, source]) => importsOf(path, source));

describe("the compiler folder", () => {
  it("imports only its own files, js-yaml and zod; its tests add only vitest, its scripts only Node", () => {
    // GIVEN every import of every TypeScript file in compiler/
    const paths = Object.keys(SOURCES);
    // WHEN the imports that leave the folder or name another package are picked out
    const outside = IMPORTS.filter((entry) => !isAllowed(entry)).map(
      ({ path, specifier }) => `${path} imports ${specifier}`,
    );
    // THEN the folder was read, and none of its imports is picked out
    expect(paths).toContain("./index.ts");
    expect(outside).toEqual([]);
  });

  it("keeps the test support and the scripts out of the code the compiler runs", () => {
    // GIVEN the imports of every file that is neither a test, test support nor a script
    const running = IMPORTS.filter(({ path }) => !isTestSupport(path) && !isScript(path));
    // WHEN those that reach into testing/ or scripts/ are picked out
    const intoTooling = running
      .filter((entry) => {
        const folder = entry.specifier.startsWith(".") ? resolvedFolders(entry)?.[0] : undefined;
        return folder === "testing" || folder === "scripts";
      })
      .map(({ path, specifier }) => `${path} imports ${specifier}`);
    // THEN there are none
    expect(intoTooling).toEqual([]);
  });

});
