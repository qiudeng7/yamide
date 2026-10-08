const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
(async () => {
  const repo = path.resolve(__dirname, "../../..");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yamide-ui-"));
  await fs.mkdir(path.join(root, "project"));
  await fs.writeFile(path.join(root, "project", "hello.txt"), "hello");
  const server = spawn(process.execPath, ["dist/main.js"], {
    cwd: path.join(repo, "apps/server"),
    env: {
      ...process.env,
      PORT: "18373",
      HOST: "127.0.0.1",
      YAMIDE_TOKEN: "ui-test-token-not-for-production",
      YAMIDE_ROOT: root,
      YAMIDE_STATE_DIR: path.join(root, "state"),
      YAMIDE_AGENTS: JSON.stringify([
        {
          id: "fixture",
          name: "Fixture",
          command: process.execPath,
          args: [path.join(repo, "apps/server/test/fixtures/mock-agent.mjs")],
        },
      ]),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const vite = spawn(
    "pnpm",
    [
      "--filter",
      "@yamide/client",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    { cwd: repo, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let browser;
  let logs = "";
  for (const child of [server, vite]) {
    child.stdout.on("data", (d) => (logs += d));
    child.stderr.on("data", (d) => (logs += d));
  }
  try {
    for (let i = 0; i < 100; i++) {
      if (
        logs.includes("Nest application successfully started") &&
        logs.includes("Local:")
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://localhost:5173");
    await page.getByLabel("服务端地址").fill("http://127.0.0.1:18373");
    await page.getByLabel("访问令牌").fill("ui-test-token-not-for-production");
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新建" }).click();
    await page.getByLabel("名称", { exact: true }).fill("UI Workspace");
    await page.getByLabel("服务器工作目录").fill(path.join(root, "project"));
    await page.getByRole("button", { name: "创建 Workspace" }).click();
    await page.getByRole("button", { name: /hello.txt/ }).click();
    await page
      .getByRole("textbox", { name: "文件内容" })
      .fill("edited on mobile");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
    assert.equal(
      await fs.readFile(path.join(root, "project", "hello.txt"), "utf8"),
      "edited on mobile",
    );
    await page.getByRole("button", { name: "＋ 终端", exact: true }).click();
    await page.getByText("已连接", { exact: true }).waitFor();
    const input = page.locator(".xterm-helper-textarea");
    await input.focus();
    await input.pressSequentially(
      "printf 'UI_TERMINAL_OK\\n'; printf ok > ui-terminal.txt",
      { delay: 20 },
    );
    await input.press("Enter");
    await page.waitForTimeout(200);
    assert.equal(
      await fs.readFile(path.join(root, "project", "ui-terminal.txt"), "utf8"),
      "ok",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await fs.mkdir(path.join(repo, "apps/client/test-results"), {
      recursive: true,
    });
    await page.screenshot({
      path: path.join(repo, "apps/client/test-results/terminal.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "＋ Agent", exact: true }).click();
    await page
      .locator(".resource-status")
      .filter({ hasText: "idle" })
      .waitFor();
    await page
      .getByPlaceholder("让 Agent 帮你完成任务…")
      .fill("test permission");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("Fixture approval", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await page
      .locator("article.assistant")
      .filter({ hasText: "approved" })
      .waitFor();
    await page.screenshot({
      path: path.join(repo, "apps/client/test-results/agent.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "‹", exact: true }).click();
    await page.getByRole("button", { name: /UI Workspace.*3 个资源/ }).click();
    await page.locator(".tabs button").filter({ hasText: "Fixture" }).click();
    await page
      .locator("article.assistant")
      .filter({ hasText: "approved" })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "Mobile layout, connect, workspace creation, file edit, PTY keyboard, ACP permission, navigation/reconnect: passed",
    );
  } catch (e) {
    console.error(logs);
    throw e;
  } finally {
    if (browser) await browser.close();
    for (const child of [vite, server]) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch { /* Already exited. */ }
    }
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
