import { expect, test } from "@playwright/test";
import { noHorizontalOverflow, submitPhoto } from "./helpers";

test("test environment is clearly labelled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/测试环境 · AI 为测试替身/u)).toBeVisible();
});

test("submit photo → stages → refresh restores the same result → poster → share → revoke", async ({ page, browser }) => {
  await submitPhoto(page, "okakura-tenshin-park", "red");
  const url = page.url();
  await expect(page.getByLabel("等级 S")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("照片地点匹配 · 未核验到访")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);

  await page.reload();
  expect(page.url()).toBe(url);
  await expect(page.getByLabel("等级 S")).toBeVisible();
  await expect(page.getByText("87", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "生成纪念票根" }).click();
  await page.getByRole("button", { name: "生成票根" }).click();
  await expect(page.getByRole("img", { name: /纪念票根/u })).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "创建分享链接" }).click();
  await expect(page.getByText("创建后，任何拿到链接的人都能看到：")).toBeVisible();
  await page.getByRole("button", { name: "确认创建分享链接" }).click();
  const shareUrl = await page.getByLabel("分享链接").inputValue();
  expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+$/u);

  // Private window: public page works without any session.
  const incognito = await browser.newContext();
  const pub = await incognito.newPage();
  await pub.goto(shareUrl);
  await expect(pub.getByRole("img", { name: /纪念票根/u })).toBeVisible();
  const imgSrc = await pub.getByRole("img", { name: /纪念票根/u }).getAttribute("src");

  await page.getByRole("button", { name: "撤销分享" }).click();
  await expect(page.getByRole("button", { name: "创建分享链接" })).toBeVisible();

  await pub.goto(shareUrl);
  await expect(pub.getByText("这个分享链接已失效")).toBeVisible();
  const img = await pub.request.get(imgSrc!);
  expect(img.status()).toBe(404);
  await incognito.close();
});

test("mismatched photo explains why, offers reshoot, never shows a grade", async ({ page }) => {
  await submitPhoto(page, "yanaka-ginza", "blue");
  await expect(page.getByText("照片与这个地点不一致")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("冲突", { exact: true })).toBeVisible();
  await expect(page.locator(".grade")).toHaveCount(0);
  await page.getByRole("link", { name: "重新拍摄" }).click();
  await expect(page.getByRole("heading", { name: "拍照打卡" })).toBeVisible();
});

test("uncertain → request review → admin approves → rating continues", async ({ page, browser }) => {
  await submitPhoto(page, "kannonji-tsuijibei", "green");
  await expect(page.getByText("无法确认是这个地点")).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "申请人工复核" }).click();
  await expect(page.getByText("人工复核：已提交，等待处理")).toBeVisible();
  const attemptUrl = page.url();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await admin.goto("/admin");
  await admin.getByLabel("用户名").fill("e2e-reviewer");
  await admin.getByLabel("密码").fill("e2e-reviewer-password");
  await admin.getByRole("button", { name: "登录" }).click();
  await admin.getByRole("button", { name: /观音寺筑地塀/u }).first().click();
  await admin.getByLabel("理由（必填）").fill("瓦土交替的墙面与参考图一致");
  await admin.getByRole("button", { name: "通过（地点一致）" }).click();
  await expect(admin.getByText("已通过：打卡已生效，并已排队进行摄影评分。")).toBeVisible();
  await adminCtx.close();

  await page.goto(attemptUrl);
  await expect(page.getByText("此结果经人工复核确认。")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("等级 S")).toBeVisible({ timeout: 40_000 });
});
