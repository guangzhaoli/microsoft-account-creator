const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBrowserSession,
  buildBrowserSpawnArgs,
} = require("../src/browser/session");

test("buildBrowserSpawnArgs adds the remote debugging and profile flags", () => {
  assert.deepEqual(buildBrowserSpawnArgs("/tmp/profile", ["--lang=en-US"]), [
    "--remote-debugging-port=0",
    "--user-data-dir=/tmp/profile",
    "--lang=en-US",
    "about:blank",
  ]);
});

test("launch uses the configured executable path and CDP launch args", async () => {
  const launches = [];
  const browserClient = {};

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
      launchBrowserProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        return { exitCode: null };
      },
      waitForDevToolsEndpoint: async () => ({
        port: 9222,
        browserWebSocketUrl: "ws://127.0.0.1:9222/devtools/browser/test",
      }),
      connectBrowserClient: async () => browserClient,
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

  const launched = await session.launch();

  assert.equal(launches.length, 1);
  assert.equal(launches[0].executablePath, "/tmp/chrome");
  assert.deepEqual(launches[0].args, [
    "--remote-debugging-port=0",
    "--user-data-dir=/tmp/ms-account-browser-123",
    "--lang=en-US",
    "about:blank",
  ]);
  assert.deepEqual(launched, {
    port: 9222,
    browserClient,
  });
});

test("newPage installs the injection script and proxy auth through the CDP adapter", async () => {
  const calls = [];
  const fakePage = {
    setDefaultTimeout(value) {
      calls.push(["timeout", value]);
    },
    async authenticate(credentials) {
      calls.push(["auth", credentials]);
    },
    async close() {},
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
      buildInjectionScript: () => "window.__fp = true;",
      getProxyCredentials: () => ({ username: "user", password: "pass" }),
      launchBrowserProcess: async () => ({ exitCode: null }),
      waitForDevToolsEndpoint: async () => ({
        port: 9222,
        browserWebSocketUrl: "ws://127.0.0.1:9222/devtools/browser/test",
      }),
      connectBrowserClient: async () => ({}),
      createPageAdapter: async (options) => {
        calls.push(["adapter", options.injectionScript, options.port]);
        return fakePage;
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
    ["adapter", "window.__fp = true;", 9222],
    ["timeout", 3600000],
    ["auth", { username: "user", password: "pass" }],
  ]);
});

test("close releases the page, browser client, process and temp profile directory", async () => {
  const closeCalls = [];
  const fakeBrowserClient = {
    Browser: {
      close: async () => closeCalls.push("browser.close"),
    },
    close: async () => closeCalls.push("browserClient.close"),
  };
  const fakeBrowserProcess = {
    exitCode: null,
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
      launchBrowserProcess: async () => fakeBrowserProcess,
      waitForDevToolsEndpoint: async () => ({
        port: 9222,
        browserWebSocketUrl: "ws://127.0.0.1:9222/devtools/browser/test",
      }),
      connectBrowserClient: async () => fakeBrowserClient,
      createPageAdapter: async () => ({
        setDefaultTimeout() {},
        authenticate: async () => {},
        close: async () => closeCalls.push("page.close"),
      }),
      terminateBrowserProcess: async () => closeCalls.push("process.terminate"),
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
  await session.newPage();
  await session.close();

  assert.deepEqual(closeCalls, [
    "page.close",
    "browser.close",
    "browserClient.close",
    "process.terminate",
    ["rm", "/tmp/ms-account-browser-123", { recursive: true, force: true }],
  ]);
});
