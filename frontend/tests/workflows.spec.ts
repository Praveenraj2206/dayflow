import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, identity = "avery") {
  await page.goto("/");
  await page.getByLabel("Work email").fill(`${identity}@dayflow.demo`);
  await page.getByLabel("Password", { exact: true }).fill("Dayflow-demo-2026!");
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".queue-table tbody tr").first()).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Dayflow" })).toBeVisible();
}

async function maya(page: Page) {
  await page.getByLabel("Search workforce").fill("Maya Chen");
  await page.getByRole("button", { name: "Open Maya Chen 2026-10-19" }).click();
  await expect(page.locator(".person-heading h2")).toHaveText("Maya Chen");
}

test("signed policy → employee confirmation → independent approval → durable pay dispute", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  await page.getByRole("button", { name: "Policy studio", exact: true }).click();
  await expect(page.getByText("Awaiting sign-off")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign & activate ruleset" }).click();
  await expect(page.getByText("This exact ruleset is active.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Exception desk", exact: true }).click();
  await maya(page);
  await page.getByRole("button", { name: "AI investigation", exact: true }).click();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.getByText("Critic: instruction override flagged", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Correction & proof", exact: true }).click();
  await page.getByRole("button", { name: "Draft correction", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Use scheduled missing boundary/ }).click();
  await dialog.getByLabel("Reason for correction").fill("Employee handover record supports restoring the missing clock-out.");
  await dialog.getByRole("button", { name: "Create proposal" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".proposal-review")).toBeVisible();
  await page.getByRole("button", { name: "Verify full period" }).click();
  await expect(page.getByText("Verification blocked", { exact: true })).toBeVisible();
  await expect(page.getByText("Employee confirmation of this revision is required", { exact: false })).toBeVisible();
  await logout(page);
  await login(page, "e001");
  await page.reload();
  await expect(page.getByRole("button", { name: "Pay explorer", exact: true })).toHaveClass(/active/);
  await maya(page);
  await page.getByRole("button", { name: "Correction & proof", exact: true }).click();
  await page.getByLabel("Review / confirmation reason").fill("I confirm these boundaries and breaks reflect my actual work.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm my worked time" }).click();
  await expect(page.getByText("Attestation recorded against this exact proposal.")).toBeVisible();
  await logout(page);
  await login(page);
  await maya(page);
  await page.getByRole("button", { name: "Correction & proof", exact: true }).click();
  await page.getByRole("button", { name: "Verify full period" }).click();
  await expect(page.getByText("Independently reproduced", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & commit" })).toBeDisabled();
  await logout(page);
  await login(page, "taylor");
  await maya(page);
  await page.getByRole("button", { name: "Correction & proof", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve & commit" })).toBeEnabled();
  await page.getByRole("button", { name: "Approve & commit" }).click();
  await expect(page.getByText("Committed by taylor", { exact: false })).toBeVisible();
  await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();
  await page.reload();
  await maya(page);
  await page.getByRole("button", { name: "Pay derivation", exact: true }).click();
  await expect(page.locator(".pay-total h2")).not.toHaveText("Not yet calculable");
  await logout(page);
  await login(page, "e001");
  await maya(page);
  await page.getByRole("button", { name: "Pay derivation", exact: true }).click();
  await page.getByRole("button", { name: "Dispute Worked time" }).first().click();
  await page.getByLabel("What would you like reviewed?").fill("Please explain the meal premium on my updated paycheck.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Please explain the meal premium on my updated paycheck.")).toBeVisible();
  await logout(page);
  await login(page, "taylor");
  // The committed card still has payable exceptions, so remains in the attention queue.
  await maya(page);
  await page.getByRole("button", { name: "Pay derivation", exact: true }).click();
  await page.getByLabel("Resolution", { exact: true }).fill("Reviewed the cited meal clause and engine derivation with Maya.");
  await page.getByRole("button", { name: "Record resolution" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Audit ledger", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The chain is intact." })).toBeVisible();
  await expect(page.getByText("verified correction committed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Eval scorecard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trust is a measured behavior." })).toBeVisible();
  await expect(page.getByText("155", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("responsive workspace, keyboard modal and policy version editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.screenshot({ path: "../artifacts/dayflow-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Correction & proof", exact: true }).click();
  await page.getByRole("button", { name: "Draft correction", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 1512, height: 1040 });
  await page.getByRole("button", { name: "Policy studio", exact: true }).click();
  await page.getByRole("button", { name: "Compile a new version" }).click();
  await expect(page.getByRole("textbox", { name: "Versioned source document" })).toBeVisible();
  await page.getByRole("button", { name: "Validate & compile draft" }).click();
  await expect(page.getByText("New immutable ruleset compiled.", { exact: false })).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Sign & activate ruleset" })).toBeDisabled();
  await page.screenshot({ path: "../artifacts/dayflow-policy.png", fullPage: true });
  await page.getByRole("button", { name: "Exception desk", exact: true }).click();
  await expect(page.locator(".queue-table")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../artifacts/dayflow-workspace.png", fullPage: true });
});

test("benign offline investigation stays useful without a model", async ({ page }) => {
  await login(page);
  await page.getByLabel("Search workforce").fill("Jordan Ellis");
  await page.getByRole("button", { name: "Open Jordan Ellis 2026-10-05" }).click();
  await page.getByRole("button", { name: "AI investigation", exact: true }).click();
  await page.getByRole("button", { name: "Run investigation", exact: true }).click();
  await expect(page.getByText("Critic: no override detected", { exact: true })).toBeVisible();
  await expect(page.getByText("No-LLM fallback", { exact: true })).toBeVisible();
  await expect(page.locator(".investigation-result")).toContainText("Deterministic");
});
