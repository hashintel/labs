import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const page = pathToFileURL(path.join(root, "dist/index.html")).href;
const out = process.env.SCREENSHOT_DIR ?? path.join(root, "screenshots");
const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await tab.goto(page);
  const ids = await tab.locator('.picker__trigger option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  await mkdir(out, { recursive: true });
  for (const id of ids) {
    await tab.goto(`${page}#${id}`);
    await tab.reload();
    await tab.locator('.net-frame svg:visible').first().waitFor();
    await tab.locator('.monaco-editor .view-line:visible').first().waitFor();
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: path.join(out, `${id}.png`) });
    console.log(`wrote ${id}.png`);
  }
  await tab.goto(`${page}#semantics`);
  await tab.locator('.question-list__row:visible').first().waitFor();
  const questions = await tab.locator('.question-list__row:visible').evaluateAll((rows) => rows.map((row) => (row as HTMLAnchorElement).hash));
  for (const hash of questions) {
    await tab.goto(`${page}${hash}`);
    await tab.locator('.question-card:visible, .docs:visible').first().waitFor();
    if (await tab.locator('.example-net:visible').count()) await tab.locator('.example-net svg:visible').first().waitFor();
    await tab.evaluate(() => document.fonts.ready);
    const name = hash.replace(/^#/, '').replaceAll('/', '-');
    await tab.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`wrote ${name}.png`);
  }
} finally {
  await browser.close();
}
