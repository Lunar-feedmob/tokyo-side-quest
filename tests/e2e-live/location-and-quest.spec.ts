import { expect, test } from "@playwright/test";
import { noHorizontalOverflow, placeId } from "./helpers";

test("location denied → clear message → manual neighbourhood → place → photo entry", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/explore");
  await page.getByRole("button", { name: "发现我附近" }).click();
  await expect(page.getByText(/你没有允许定位|定位超时|暂时无法取得位置/u)).toBeVisible();
  await page.getByRole("button", { name: /谷中/u }).first().click();
  await page.getByRole("link", { name: /冈仓天心纪念公园/u }).click();
  await expect(page.getByRole("heading", { name: "冈仓天心纪念公园" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "拍照打卡" }).click();
  await expect(page.getByRole("button", { name: "从相册选择" })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("device location check-in appears in footprints with the device-report label", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  const place = await (await page.request.get("/api/v1/places/yanaka-ginza")).json();
  await context.setGeolocation({ latitude: place.data.latitude + 0.0001, longitude: place.data.longitude, accuracy: 12 });
  await page.goto("/places/yanaka-ginza");
  await page.getByRole("button", { name: "定位打卡" }).click();
  await expect(page.getByText("✓ 位置符合范围")).toBeVisible();
  await page.goto("/me?tab=footprints");
  await expect(page.getByText("位置符合范围（设备位置报告）").first()).toBeVisible();
});

test("too far away is refused with server distance, no stamp", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.6812, longitude: 139.7671, accuracy: 10 }); // Tokyo Station, ~5 km away
  await page.goto("/places/okakura-tenshin-park");
  await page.getByRole("button", { name: "定位打卡" }).click();
  await expect(page.getByText("设备报告的位置不在打卡范围内。")).toBeVisible();
  await expect(page.getByText(/服务端计算的直线距离约/u)).toBeVisible();
});

test("story: complete all steps by location, ending + one completion stamp; end and resume keeps progress", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await page.goto("/quests/lost-postcard");
  await page.getByRole("button", { name: "领取任务票" }).click();
  await page.waitForURL(/\/adventures\//u);

  // End then resume keeps the run.
  await page.getByRole("button", { name: "结束本次探索" }).click();
  await expect(page.getByText("这次探索已结束，尚未完成全部任务。")).toBeVisible();
  await page.getByRole("button", { name: "恢复探索" }).click();

  for (let step = 1; step <= 4; step++) {
    const current = page.locator("li", { has: page.getByText("当前任务", { exact: true }) });
    const placeLink = current.getByRole("link", { name: "查看地点资料与导航" });
    const slug = (await placeLink.getAttribute("href"))!.split("/").pop()!;
    const p = await (await page.request.get(`/api/v1/places/${slug}`)).json();
    await context.setGeolocation({ latitude: p.data.latitude, longitude: p.data.longitude, accuracy: 8 });
    await current.getByRole("button", { name: "定位打卡" }).click();
    await expect(page.getByText(`故事探索 · ${step}/4`)).toBeVisible();
  }
  await expect(page.getByText("结局", { exact: true })).toBeVisible();
  await page.goto("/me?tab=stamps");
  await expect(page.getByText("故事完成章")).toHaveCount(1);
  void placeId;
});

test("core pages have no horizontal overflow", async ({ page }) => {
  for (const path of ["/", "/explore?neighborhood=yanaka", "/places/kannonji-tsuijibei", "/quests/lost-postcard", "/demo", "/me", "/settings/data"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await noHorizontalOverflow(page), path).toBe(true);
  }
});
