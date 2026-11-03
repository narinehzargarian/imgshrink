import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

test.skip(!!process.env.BENCH, "benchmark run");

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute("data-engine", "ready");
}

async function upload(page: Page, ...names: string[]) {
  await page.locator('input[type="file"]').setInputFiles(names.map(fixture));
}

const rows = (page: Page) => page.getByTestId("result");

/** Reads pixel (x, y) of the processed image shown in result row `index`. */
async function pixelOf(page: Page, index: number, x: number, y: number) {
  return rows(page)
    .nth(index)
    .locator("img")
    .evaluate(async (img: HTMLImageElement, [px, py]) => {
      const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return [...context.getImageData(px!, py!, 1, 1).data];
    }, [x, y]);
}

test("resizes a photo to the default 1920 px and makes it smaller", async ({ page }) => {
  await open(page);
  await upload(page, "photo.jpg");
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-status", "done");
  await expect(row.getByTestId("dimensions")).toHaveText("1920 × 1280");

  const download = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: "Download" }).click()]).then(([d]) => d);
  expect(download.suggestedFilename()).toBe("photo.jpg");
  const saved = await download.path();
  const bytes = readFileSync(saved);
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(bytes.length).toBeLessThan(statSync(fixture("photo.jpg")).size / 2);
});

test("turns a sideways phone photo upright", async ({ page }) => {
  await open(page);
  await page.getByLabel("Longest side").selectOption("0");
  await upload(page, "portrait-rotated.jpg");
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-status", "done");
  // Stored as 600 x 400 with a "rotate 90°" tag; shown correctly it's 400 x 600.
  await expect(row.getByTestId("dimensions")).toHaveText("400 × 600");
  // The red band marks the photo's real top edge.
  const [r, g] = await pixelOf(page, 0, 200, 20);
  expect(r).toBeGreaterThan(200);
  expect(g).toBeLessThan(80);
});

test("PNG with fewer colors shrinks a logo and keeps its transparency", async ({ page }) => {
  await open(page);
  await page.getByText("PNG, fewer colors").click();
  await page.getByLabel("Longest side").selectOption("0");
  await upload(page, "logo.png");
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-status", "done");
  await expect(row.locator(".saved")).toBeVisible();
  const [, , , cornerAlpha] = await pixelOf(page, 0, 5, 5);
  const [, , , centerAlpha] = await pixelOf(page, 0, 300, 300);
  expect(cornerAlpha).toBe(0);
  expect(centerAlpha).toBe(255);
});

test("keeps the original when it's already smaller", async ({ page }) => {
  await open(page);
  // A small JPEG saved at quality 25: saving it again at quality 95 can only grow it.
  await page.getByRole("slider").fill("95");
  await upload(page, "compressed.jpg");
  const row = rows(page).first();
  await expect(row).toHaveAttribute("data-status", "done");
  await expect(row).toContainText("original kept");
  const download = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: "Download" }).click()]).then(([d]) => d);
  expect(readFileSync(await download.path()).equals(readFileSync(fixture("compressed.jpg")))).toBe(true);
});

test("explains when a file isn't an image", async ({ page }) => {
  await open(page);
  await upload(page, "not-an-image.jpg");
  await expect(rows(page).first()).toHaveAttribute("data-status", "error");
  await expect(rows(page).first()).toContainText("can't open this file as an image");
});

test("processes a batch and downloads it as one zip", async ({ page }) => {
  await open(page);
  await upload(page, "photo.jpg", "logo.png", "portrait-rotated.jpg");
  await expect(rows(page)).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(rows(page).nth(i)).toHaveAttribute("data-status", "done");
  await expect(page.getByRole("status")).toContainText("3 done");

  const download = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all (.zip)" }).click()]).then(([d]) => d);
  expect(download.suggestedFilename()).toBe("imgshrink.zip");
  const path = await download.path();
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain("No errors detected");
  const names = JSON.parse(execFileSync("python3", ["-c", "import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", path], { encoding: "utf8" }));
  expect(names).toEqual(["photo.jpg", "logo.jpg", "portrait-rotated.jpg"]);
});

test("changing a setting redoes the images, and settings are remembered", async ({ page }) => {
  await open(page);
  await upload(page, "photo.jpg");
  await expect(rows(page).first().getByTestId("dimensions")).toHaveText("1920 × 1280");
  await page.getByLabel("Longest side").selectOption("800");
  await expect(rows(page).first().getByTestId("dimensions")).toHaveText("800 × 533");

  await page.reload();
  await expect(page.getByLabel("Longest side")).toHaveValue("800");
});

test("nothing is uploaded: every request stays on this site and only fetches files", async ({ page, baseURL }) => {
  const requests: { url: string; method: string; hasBody: boolean }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), hasBody: request.postDataBuffer() !== null }));
  await open(page);
  await upload(page, "photo.jpg", "logo.png");
  for (let i = 0; i < 2; i++) await expect(rows(page).nth(i)).toHaveAttribute("data-status", "done");

  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    const url = new URL(request.url);
    // blob: and data: URLs are in-memory files inside the page, not network requests.
    if (url.protocol === "blob:" || url.protocol === "data:") continue;
    expect(url.origin, request.url).toBe(new URL(baseURL!).origin);
    expect(request.method, request.url).toBe("GET");
    expect(request.hasBody, request.url).toBe(false);
  }
});

test("works offline after the first visit", async ({ page, context }) => {
  await open(page);
  // Wait until the offline cache holds the page, its scripts, the worker, and the WebAssembly.
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open("imgshrink-v1")).keys()).map((r) => r.url).join(" ")), { timeout: 20_000 })
    .toMatch(/\.wasm.*|.*\.wasm/);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("data-engine", "ready");
  await upload(page, "photo.jpg");
  await expect(rows(page).first()).toHaveAttribute("data-status", "done");
  await expect(rows(page).first().getByTestId("dimensions")).toHaveText("1920 × 1280");
});
