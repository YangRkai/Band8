import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

test("a complete server restart preserves authoritative browser projections exactly once", async ({ page }) => {
  test.skip(process.env.BAND8_E2E_RESTART !== "1", "executed by the second restart phase");
  const expected = JSON.parse(readFileSync(resolve(process.cwd(), ".tmp", "phase1d-browser-before-restart.json"), "utf8")) as Record<string, unknown>;
  await page.goto("/#settings");
  await expect(page.getByLabel("Learning timezone")).toHaveValue("America/Los_Angeles");

  const afterRestart: Record<string, unknown> = {};
  for (const route of ["today", "training", "progress", "history?limit=100", "coach", "settings"]) {
    afterRestart[route] = await (await page.request.get(`/api/v1/${route}`)).json();
  }
  expect(afterRestart).toEqual(expected);

  const todayBefore = afterRestart.today as { mission: null | { objective: string }; coach_status: string };
  await page.goto("/#today");
  if (todayBefore.mission !== null) await expect(page.getByRole("heading", { name: todayBefore.mission.objective })).toBeVisible();
  await expect(page.getByText(`Coach: ${todayBefore.coach_status.replaceAll("_", " ")}`)).toBeVisible();
  await page.reload();
  const todayAfter = await (await page.request.get("/api/v1/today")).json();
  expect(todayAfter).toEqual(expected.today);

  await page.goto("/#history");
  await expect(page.locator(".history-item")).toHaveCount(20);
  await page.getByRole("button", { name: "LOAD MORE" }).click();
  const expectedHistory = expected["history?limit=100"] as { items: unknown[] };
  await expect(page.locator(".history-item")).toHaveCount(expectedHistory.items.length);
  await expect(page.getByText("QUARANTINED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("tampered synthetic artifact", { exact: false })).toHaveCount(0);
});
