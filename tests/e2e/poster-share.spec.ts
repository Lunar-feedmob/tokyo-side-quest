import { expect, test } from "@playwright/test";

test("demo poster: generate and download a real PNG with demo label", async ({ page, request }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: /样例 A/u }).first().click();
  await expect(page.getByLabel("等级 S")).toBeVisible();
  await page.getByRole("link", { name: "生成试玩纪念票根" }).click();
  await expect(page.getByRole("heading", { name: "选择封面与短句" })).toBeVisible();
  await page.getByLabel("短句（可选，最多 40 字）").fill("瓦与土，一层一层。");
  await page.getByRole("button", { name: "生成票根" }).click();
  await expect(page).toHaveURL(/\/posters\//u);
  const img = page.getByRole("img", { name: /纪念票根/u });
  await expect(img).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("试玩票根带“试玩纪念”标识，不能创建公开分享链接。")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: /下载 PNG/u }).click();
  const file = await download;
  const path = await file.path();
  const fs = await import("node:fs/promises");
  const bytes = await fs.readFile(path!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  void request;
});
