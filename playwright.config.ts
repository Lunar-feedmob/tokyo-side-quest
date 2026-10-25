import { defineConfig, devices } from "@playwright/test";

// tests/e2e       → demo and API checks against the dev server (BASE_URL, default :3000)
// tests/e2e-live  → live-mode flows against the isolated TEST stack from
//                   scripts/e2e-stack.sh (:3100, fake vision provider, own DB)
export default defineConfig({
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    locale: "zh-CN",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-390",
      testDir: "tests/e2e",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, baseURL: process.env.BASE_URL ?? "http://localhost:3000" },
    },
    {
      name: "desktop-1440",
      testDir: "tests/e2e",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: process.env.BASE_URL ?? "http://localhost:3000" },
    },
    {
      name: "live-360",
      testDir: "tests/e2e-live",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 }, baseURL: process.env.LIVE_BASE_URL ?? "http://localhost:3100" },
    },
    {
      name: "live-1440",
      testDir: "tests/e2e-live",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: process.env.LIVE_BASE_URL ?? "http://localhost:3100" },
    },
  ],
});
