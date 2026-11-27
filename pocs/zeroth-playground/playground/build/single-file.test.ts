import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { singleFile } from "./single-file";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "zeroth-single-file-"));
  folders.push(root);
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(root, name), contents);
  return root;
}

async function compile(root: string) {
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [singleFile()],
    build: { write: false, minify: false },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !("output" in output)) throw new Error("build output is missing");
  return output.output;
}

describe("the single-file build", () => {
  it("embeds scripts, styles, and imported assets in one HTML file", async () => {
    // GIVEN a page with JavaScript, CSS, an imported asset, and a dynamic import
    const root = fixture({
      "index.html": '<!doctype html><html><head></head><body><script type="module" src="./main.js"></script></body></html>',
      "main.js": 'import "./style.css"; import icon from "./icon.svg"; document.body.dataset.icon = icon; import("./lazy.js").then(({ value }) => { document.body.dataset.value = value; });',
      "lazy.js": 'export const value = "loaded";',
      "style.css": 'body { background-image: url("./icon.svg"); }',
      "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2" /></svg>',
    });
    // WHEN Vite builds it with the single-file hook
    const files = await compile(root);
    const html = files.find((file) => file.type === "asset");
    // THEN the only output embeds the code, stylesheet, and image
    expect(files.map((file) => file.fileName)).toEqual(["index.html"]);
    if (html?.type !== "asset") throw new Error("HTML asset is missing");
    const text = html.source.toString();
    expect(text).toContain('<script type="module">');
    expect(text).toContain("<style>");
    expect(text).toContain("data:image/svg+xml");
    expect(text).toContain('"loaded"');
    expect(text).not.toMatch(/<script[^>]+src=|<link[^>]+rel="stylesheet"/u);
    expect(text).not.toContain("__VITE_PRELOAD__");
  });

  it("keeps closing-script strings inside the JavaScript", async () => {
    // GIVEN JavaScript containing a case-insensitive HTML script terminator
    const root = fixture({
      "index.html": '<html><body><script type="module" src="./main.js"></script></body></html>',
      "main.js": 'document.body.dataset.value = "</SCRIPT><!--";',
    });
    // WHEN it is embedded into the HTML
    const files = await compile(root);
    const html = files.find((file) => file.type === "asset");
    // THEN the string cannot close the enclosing script or open an HTML comment
    if (html?.type !== "asset") throw new Error("HTML asset is missing");
    const text = html.source.toString();
    expect(text.match(/<\/script>/giu)).toHaveLength(1);
    expect(text).not.toContain("<!--");
  });
});
