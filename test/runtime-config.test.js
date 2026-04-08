const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateRuntimeConfig,
  buildProxyServerArg,
  getProxyCredentials,
} = require("../src/browser/runtime-config");

test("missing browser executable path fails hard", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        {
          BROWSER_EXECUTABLE_PATH: "   ",
          USE_PROXY: false,
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
          USE_PROXY: true,
          PROXY_IP: "127.0.0.1",
          PROXY_PORT: "8080",
          PROXY_USERNAME: "user",
          PROXY_PASSWORD: "",
        },
        {
          accessSync: () => {},
          constants: { X_OK: 1 },
        }
      ),
    /PROXY_USERNAME.*PROXY_PASSWORD|PROXY_PASSWORD.*PROXY_USERNAME/
  );
});

test("valid proxy config returns expected proxy helpers", () => {
  const calls = [];
  const config = {
    BROWSER_EXECUTABLE_PATH: "/opt/browser",
    USE_PROXY: true,
    PROXY_IP: "10.0.0.1",
    PROXY_PORT: "3128",
    PROXY_USERNAME: "alice",
    PROXY_PASSWORD: "secret",
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
    USE_PROXY: false,
    PROXY_IP: "10.0.0.1",
    PROXY_PORT: "3128",
    PROXY_USERNAME: "alice",
    PROXY_PASSWORD: "secret",
  };

  validateRuntimeConfig(config, {
    accessSync: () => {},
    constants: { X_OK: 1 },
  });

  assert.equal(buildProxyServerArg(config), null);
  assert.equal(getProxyCredentials(config), null);
});
