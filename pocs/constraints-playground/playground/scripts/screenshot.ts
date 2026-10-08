/**
 * Screenshots every example the picker lists at 1440x900 into `screenshots/`,
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
  // The collapsed list shows only the sandbox and the pressing rows; "Show more" lists every example.
  await tab.getByRole("button", { name: "Show more" }).click();
  const ids = await tab.$$eval('.picker__list [role="option"]', (options) =>
    options.map((option) => option.getAttribute("data-example") ?? ""),
  );
  await mkdir(out, { recursive: true });
  for (const id of ids) {
    await tab.goto(`${page}#${id}`);
    await tab.reload();
    await tab.waitForSelector(".monaco-editor .view-line");
    await tab.locator(".net-frame svg, .net-frame .note").first().waitFor();
    await tab.locator(".docs h2").first().waitFor();
    await tab.locator(".run__verdict, .run .note").first().waitFor();
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForTimeout(400);
    const file = path.join(out, `${id}.png`);
    await tab.screenshot({ path: file });
    console.log(`wrote ${path.relative(root, file)}`);
  }
} finally {
  await browser.close();
}
