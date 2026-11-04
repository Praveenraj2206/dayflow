import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:8011", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && cd .. && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8011",
    url: "http://127.0.0.1:8011/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DAYFLOW_DB: path.resolve(`../artifacts/e2e-${process.pid}.sqlite3`),
      DAYFLOW_LLM_MODE: "off",
      DAYFLOW_ALLOWED_ORIGINS: "http://127.0.0.1:8011",
    },
  },
});
