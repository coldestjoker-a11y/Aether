import { test, expect } from "@playwright/test";

test.describe("AetherVault E2E Testnet Flows (Create, Send, Swap)", () => {
  test("completes full onboarding quiz, views Sepolia dashboard, simulates send and swap", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000");

    // 1. Create Wallet Flow
    await page.getByTestId("btn-create-wallet").click();
    await page.getByTestId("btn-reveal-phrase").click();

    // Read words #3, #7, #11 from the DOM for the confirmation quiz
    const word2 = (await page.getByTestId("mnemonic-word-2").innerText())
      .replace(/^\d+\.\s*/, "")
      .trim();
    const word6 = (await page.getByTestId("mnemonic-word-6").innerText())
      .replace(/^\d+\.\s*/, "")
      .trim();
    const word10 = (await page.getByTestId("mnemonic-word-10").innerText())
      .replace(/^\d+\.\s*/, "")
      .trim();

    await page.getByTestId("btn-proceed-quiz").click();

    await page.getByTestId(`quiz-option-${word2}`).first().click();
    await page.getByTestId(`quiz-option-${word6}`).first().click();
    await page.getByTestId(`quiz-option-${word10}`).first().click();
    await page.getByTestId("btn-verify-quiz").click();

    // 2. Encrypt Keystore with Password
    await page.getByTestId("input-password").fill("TestnetVaultPass#99");
    await page.getByTestId("input-confirm-password").fill("TestnetVaultPass#99");
    await page.getByTestId("btn-complete-onboarding").click();

    // 3. Verify Dashboard renders on Sepolia Testnet
    await expect(page.getByText("Total Portfolio Balance")).toBeVisible();

    // 4. Navigate to Send and verify First-Time Recipient Warning
    await page.getByTestId("quick-btn-send").click();
    await page
      .getByTestId("send-recipient-input")
      .fill("0x1111111111111111111111111111111111111111");
    await expect(page.getByTestId("first-time-recipient-warning")).toBeVisible();

    // 5. Navigate to Swap and verify live quote calculation
    await page.getByTestId("nav-swap").click();
    await page.getByTestId("swap-sell-amount").fill("1");
    await expect(page.getByTestId("btn-review-swap")).toBeEnabled({
      timeout: 15000,
    });
  });

  test("verifies standalone /admin portal passcode gate and access", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000/admin");

    // Verify admin passcode gate is shown
    await expect(page.getByText("AetherVault Admin Ops")).toBeVisible();
    await expect(page.getByTestId("admin-passcode-input")).toBeVisible();

    // Authenticate with passcode
    await page.getByTestId("admin-passcode-input").fill("admin2026");
    await page.getByTestId("btn-enter-admin").click();

    // Verify entry into full Admin Command Center
    await expect(
      page.getByText("AetherVault Admin Command Center")
    ).toBeVisible();
    await expect(page.getByText("Real-Time IN/OUT Mempool Monitor")).toBeVisible();
  });
});
