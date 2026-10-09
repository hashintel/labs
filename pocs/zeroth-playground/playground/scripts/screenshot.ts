/**
 * Screenshots every example the picker lists at 1440x900 into `screenshots/`,
 * then the Compiler view and the Semantics view with and without a question,
 * opening `dist/index.html` from disk as a reader would. Run `pnpm build`
 * first, then `pnpm screenshot`.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const page = pathToFileURL(path.join(root, "dist", "index.html")).href;
const out = path.join(root, "screenshots");

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await tab.goto(page);
  // The picker lists the examples up the ladder; each one opens from its hash on a fresh load.
  await tab.click(".picker__trigger");
  const ids = await tab.$$eval('.picker__list [role="option"]', (options) =>
    options.map((option) => option.getAttribute("data-example") ?? ""),
  );
  await mkdir(out, { recursive: true });
  for (const id of ids) {
    await tab.goto(`${page}#${id}`);
    await tab.reload();
    await tab.waitForSelector(".monaco-editor .view-line");
    // Both views stay mounted, the hidden one under Activity: wait on what is visible.
    await tab.locator(".net-frame svg, .net-frame .note").filter({ visible: true }).first().waitFor();
    await tab.locator(".docs h2").filter({ visible: true }).first().waitFor();
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(400);
    const file = path.join(out, `${id}.png`);
    await tab.screenshot({ path: file });
    console.log(`wrote ${path.relative(root, file)}`);
  }
  // The compiler view, fed by the first example.
  await tab.goto(`${page}#${ids[0] ?? "cycle"}`);
  await tab.reload();
  await tab.waitForSelector(".monaco-editor .view-line");
  await tab.click('.header__view:text-is("Compiler")');
  await tab.locator(".panel__body svg").filter({ visible: true }).first().waitFor();
  await tab.waitForTimeout(400);
  const compiler = path.join(out, "compiler.png");
  await tab.screenshot({ path: compiler });
  console.log(`wrote ${path.relative(root, compiler)}`);
  // The Semantics view: the intro with the list, then one question selected from its hash.
  for (const [hash, name] of [
    ["semantics", "semantics.png"],
    ["semantics/ties-under-clocks", "semantics-question.png"],
  ] as const) {
    await tab.goto(`${page}#${hash}`);
    await tab.reload();
    await tab.locator(".question-list__row").filter({ visible: true }).first().waitFor();
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(400);
    const file = path.join(out, name);
    await tab.screenshot({ path: file });
    console.log(`wrote ${path.relative(root, file)}`);
  }
} finally {
  await browser.close();
}
