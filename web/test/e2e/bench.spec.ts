import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The speed comparison. Run with: npm run bench (results go to bench/results.json).
test.skip(!process.env.BENCH, "set BENCH=1 to run the speed comparison");

test("WebAssembly vs JavaScript vs canvas resize", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?bench");
  const handle = await page.waitForFunction(() => (window as unknown as { benchResults?: unknown }).benchResults, null, { timeout: 280_000 });
  const results = (await handle.jsonValue()) as { wasmMs: number; jsMs: number; canvasMs: number; maxDifferenceWasmVsJs: number };
  console.log(JSON.stringify(results, null, 2));
  expect(results.maxDifferenceWasmVsJs).toBeLessThanOrEqual(1);
  const dir = fileURLToPath(new URL("../../bench/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}results.json`, JSON.stringify(results, null, 2) + "\n");
});
