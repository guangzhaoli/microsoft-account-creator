const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateRuntimeConfig,
  buildProxyServerArg,
  getProxyCredentials,
  resolveTaskProxy,
  withResolvedProxy,
} = require("../src/browser/runtime-config");

test("missing browser executable path fails hard", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "   ",
          COUNTS: 1,
          WORKERS: 1,
          PROXY_MODE: "none",
        },
        {
          accessSync: () => {},
          constants: { X_OK: 1 },
        }
      ),
    /BROWSER_EXECUTABLE_PATH/
  );
});

test("partial proxy credentials fail hard", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "/tmp/browser",
          COUNTS: 1,
          WORKERS: 1,
          PROXY_MODE: "fixed",
          PROXY: "http://user@127.0.0.1:8080",
        },
        {
          accessSync: () => {},
          constants: { X_OK: 1 },
        }
      ),
    /proxy username and password must both be set together/
  );
});

test("non-executable browser path is reported as a clear config error", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "/tmp/browser",
          COUNTS: 1,
          WORKERS: 1,
          PROXY_MODE: "none",
        },
        {
          accessSync: () => {
            throw new Error("EACCES");
          },
          constants: { X_OK: 1 },
        }
      ),
    /BROWSER_EXECUTABLE_PATH is not executable: \/tmp\/browser/
  );
});

test("valid proxy config returns expected proxy helpers", () => {
  const calls = [];
  const config = {
    BROWSER_EXECUTABLE_PATH: "/opt/browser",
    COUNTS: 1,
    WORKERS: 1,
    PROXY_MODE: "fixed",
    PROXY: "http://alice:secret@10.0.0.1:3128",
  };

  validateRuntimeConfig(config, {
    accessSync: (targetPath, mode) => {
      calls.push({ targetPath, mode });
    },
    constants: { X_OK: 99 },
  });

  assert.deepEqual(calls, [{ targetPath: "/opt/browser", mode: 99 }]);
  assert.equal(buildProxyServerArg(config), "http://10.0.0.1:3128");
  assert.deepEqual(getProxyCredentials(config), {
    username: "alice",
    password: "secret",
  });
});

test("proxy helpers return null when proxy disabled", () => {
  const config = {
    BROWSER_EXECUTABLE_PATH: "/opt/browser",
    COUNTS: 1,
    WORKERS: 1,
    PROXY_MODE: "none",
    PROXY: "http://alice:secret@10.0.0.1:3128",
  };

  validateRuntimeConfig(config, {
    accessSync: () => {},
    constants: { X_OK: 1 },
  });

  assert.equal(buildProxyServerArg(config), null);
  assert.equal(getProxyCredentials(config), null);
});

test("pool mode resolves a proxy entry and withResolvedProxy freezes it for one attempt", async () => {
  const config = {
    BROWSER_EXECUTABLE_PATH: "/opt/browser",
    COUNTS: 1,
    WORKERS: 1,
    PROXY_MODE: "pool",
    PROXY_POOL: ["http://pool-a:8080", "socks5://pool-b:1080"],
  };

  validateRuntimeConfig(config, {
    accessSync: () => {},
    constants: { X_OK: 1 },
  });

  const selected = await resolveTaskProxy(config, {
    pickProxyPoolEntry: async (entries) => entries[1],
  });
  const resolved = withResolvedProxy(config, selected);

  assert.equal(selected, "socks5://pool-b:1080");
  assert.equal(resolved.PROXY_MODE, "fixed");
  assert.equal(resolved.PROXY, "socks5://pool-b:1080");
  assert.deepEqual(resolved.PROXY_POOL, []);
  assert.equal(resolved.PROXY_POOL_CONFIG_FILE, "");
});

test("oauth2 config requires client id, redirect url, scopes, and output file when enabled", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "/opt/browser",
          COUNTS: 1,
          WORKERS: 1,
          PROXY_MODE: "none",
          ENABLE_OAUTH2: true,
          OAUTH2_CLIENT_ID: "",
          OAUTH2_REDIRECT_URL: "",
          OAUTH2_SCOPES: [],
          OAUTH_TOKENS_FILE: "",
          OAUTH_TOKENS_TEXT_FILE: "",
        },
        {
          accessSync: () => {},
          constants: { X_OK: 1 },
        }
      ),
    /OAUTH2_CLIENT_ID|OAUTH2_REDIRECT_URL|OAUTH2_SCOPES|OAUTH_TOKENS_FILE|OAUTH_TOKENS_TEXT_FILE/
  );
});

test("counts and workers must be positive integers", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "/opt/browser",
          PROXY_MODE: "none",
          COUNTS: 0,
          WORKERS: "2",
        },
        {
          accessSync: () => {},
          constants: { X_OK: 1 },
        }
      ),
    /COUNTS|WORKERS/
  );
});

test("pool mode requires pool entries or a pool config file", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "/opt/browser",
          COUNTS: 1,
          WORKERS: 1,
          PROXY_MODE: "pool",
          PROXY_POOL: [],
          PROXY_POOL_CONFIG_FILE: "",
        },
        {
          accessSync: () => {},
          constants: { X_OK: 1 },
        }
      ),
    /PROXY_POOL|PROXY_POOL_CONFIG_FILE/
  );
});
