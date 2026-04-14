const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBrowserSession,
  createPuppeteerExtra,
} = require("../src/browser/session");

test("createPuppeteerExtra wraps the base puppeteer instance", () => {
  const calls = [];
  const basePuppeteer = { launch() {} };
  const wrappedPuppeteer = {};

  const result = createPuppeteerExtra({
    basePuppeteer,
    addExtra(puppeteerInstance) {
      calls.push(["addExtra", puppeteerInstance]);
      return wrappedPuppeteer;
    },
  });

  assert.equal(result, wrappedPuppeteer);
  assert.deepEqual(calls, [["addExtra", basePuppeteer]]);
});

test("launch uses the configured executable path and launch args", async () => {
  const launches = [];
  const fakeBrowser = {
    newPage: async () => ({
      setDefaultTimeout() {},
      evaluateOnNewDocument: async () => {},
      authenticate: async () => {},
    }),
    close: async () => {},
  };

  const session = createBrowserSession(
    {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
    },
    {
      validateRuntimeConfig() {},
      createFingerprintProfile: () => ({
        language: "en-US",
        screen: { width: 1512, height: 982 },
      }),
      buildLaunchArgs: () => ["--lang=en-US"],
      buildInjectionScript: () => "window.__fp = true;",
      puppeteer: {
        launch: async (options) => {
          launches.push(options);
          return fakeBrowser;
        },
      },
      fs: {
        promises: {
          mkdtemp: async () => "/tmp/ms-account-browser-123",
          rm: async () => {},
        },
      },
      os: { tmpdir: () => "/tmp" },
      path: { join: (...parts) => parts.join("/") },
    }
  );

  await session.launch();

  assert.equal(launches.length, 1);
  assert.equal(launches[0].executablePath, "/tmp/chrome");
  assert.deepEqual(launches[0].args, ["--lang=en-US"]);
  assert.equal(launches[0].headless, false);
  assert.equal(launches[0].userDataDir, "/tmp/ms-account-browser-123");
});

test("newPage installs the injection script and proxy auth", async () => {
  const calls = [];
  const fakePage = {
    setDefaultTimeout(value) {
      calls.push(["timeout", value]);
    },
    async evaluateOnNewDocument(script) {
      calls.push(["script", script]);
    },
    async authenticate(credentials) {
      calls.push(["auth", credentials]);
    },
  };

  const session = createBrowserSession(
    {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "fixed",
      PROXY: "http://user:pass@127.0.0.1:8080",
    },
    {
      validateRuntimeConfig() {},
      createFingerprintProfile: () => ({
        language: "en-US",
        screen: { width: 1512, height: 982 },
      }),
      buildLaunchArgs: () => ["--lang=en-US"],
      buildInjectionScript: () => "",
      getProxyCredentials: () => ({ username: "user", password: "pass" }),
      puppeteer: {
        launch: async () => ({
          newPage: async () => fakePage,
          close: async () => {},
        }),
      },
      fs: {
        promises: {
          mkdtemp: async () => "/tmp/ms-account-browser-123",
          rm: async () => {},
        },
      },
      os: { tmpdir: () => "/tmp" },
      path: { join: (...parts) => parts.join("/") },
    }
  );

  await session.launch();
  await session.newPage();

  assert.deepEqual(calls, [
    ["timeout", 3600000],
    ["auth", { username: "user", password: "pass" }],
  ]);
});

test("close releases the browser and removes the temp profile directory", async () => {
  const closeCalls = [];

  const session = createBrowserSession(
    {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
    },
    {
      validateRuntimeConfig() {},
      createFingerprintProfile: () => ({
        language: "en-US",
        screen: { width: 1512, height: 982 },
      }),
      buildLaunchArgs: () => ["--lang=en-US"],
      buildInjectionScript: () => "window.__fp = true;",
      puppeteer: {
        launch: async () => ({
          newPage: async () => ({
            setDefaultTimeout() {},
            evaluateOnNewDocument: async () => {},
          }),
          close: async () => closeCalls.push("browser.close"),
        }),
      },
      fs: {
        promises: {
          mkdtemp: async () => "/tmp/ms-account-browser-123",
          rm: async (target, options) =>
            closeCalls.push(["rm", target, options]),
        },
      },
      os: { tmpdir: () => "/tmp" },
      path: { join: (...parts) => parts.join("/") },
    }
  );

  await session.launch();
  await session.close();

  assert.deepEqual(closeCalls, [
    "browser.close",
    ["rm", "/tmp/ms-account-browser-123", { recursive: true, force: true }],
  ]);
});
