import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { Page } from "@playwright/test";

// The TEST stack uses the fake vision provider: red → matched (S/87),
// green → uncertain, blue → mismatched. It never runs in production.
export async function colourPhoto(colour: "red" | "green" | "blue"): Promise<string> {
  const hex = { red: "#c7372f", green: "#2f9e44", blue: "#1c4fd6" }[colour];
  const dir = "test-results/fixtures";
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${colour}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  // Add a little noise so each upload is a distinct image (no cross-test dedupe).
  const base = await sharp({ create: { width: 640, height: 480, channels: 3, background: hex } }).jpeg().toBuffer();
  const noise = Buffer.from(`<svg width="640" height="480"><text x="20" y="40" font-size="20" fill="${hex}">${Math.random()}</text></svg>`);
  await writeFile(path, await sharp(base).composite([{ input: noise }]).jpeg().toBuffer());
  return path;
}

export async function placeId(page: Page, slug: string): Promise<string> {
  const res = await page.request.get(`/api/v1/places/${slug}`);
  return (await res.json()).data.id;
}

export async function submitPhoto(page: Page, slug: string, colour: "red" | "green" | "blue", query = "") {
  const id = await placeId(page, slug);
  await page.goto(`/checkin/${id}${query}`);
  await page.locator('input[type="file"]:not([capture])').setInputFiles(await colourPhoto(colour));
  await page.getByRole("button", { name: "提交核验" }).click();
  await page.waitForURL(/\/attempts\//u);
}

export async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
