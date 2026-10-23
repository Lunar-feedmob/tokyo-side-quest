import { expect, test } from "@playwright/test";

test("demo: complete the story with simulated location and samples, isolated from live", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("这里是独立的试玩空间")).toBeVisible();
  await page.getByRole("button", { name: "开始试玩这段故事" }).click();
  await expect(page).toHaveURL(/\/demo\/adventure\//u);
  await expect(page.getByText("试玩模式")).toBeVisible();

  for (let step = 1; step <= 4; step++) {
    const current = page.locator("li", { has: page.getByText("当前任务", { exact: true }) });
    await expect(current).toBeVisible();
    await current.getByRole("button", { name: "模拟到达并打卡（试玩）" }).click();
    await expect(page.getByText(`故事探索 · ${step}/4`)).toBeVisible();
    await expect(page.getByText("完成依据：位置符合范围 · 模拟定位")).toHaveCount(step);
  }

  await expect(page.getByText("结局", { exact: true })).toBeVisible();
  await expect(page.getByText("你没有找到那家邮局")).toBeVisible();

  // Live space stays empty.
  await page.goto("/me");
  await expect(page.locator("dd").first()).toHaveText("0");
  await page.goto("/me?mode=demo&tab=stamps");
  await expect(page.getByText("故事完成章")).toBeVisible();
});

test("demo: sample photo shows match → rating, and mismatch shows no grade", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: /样例 A/u }).first().click();
  await expect(page).toHaveURL(/\/attempts\//u);
  await expect(page.getByText("✓ 地点匹配")).toBeVisible();
  await expect(page.getByLabel("等级 S")).toBeVisible();
  await expect(page.getByText("试玩模式")).toBeVisible();

  await page.goto("/demo");
  await page.getByRole("button", { name: /样例 C/u }).first().click();
  await expect(page.getByText("照片与这个地点不一致")).toBeVisible();
  await expect(page.locator(".grade")).toHaveCount(0);
});
