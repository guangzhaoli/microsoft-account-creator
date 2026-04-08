const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
} = require("../src/browser/fingerprint");

test("launch args include the required anti-automation and locale settings", () => {
  const profile = createFingerprintProfile();
  const args = buildLaunchArgs(profile, { USE_PROXY: false });

  assert.ok(args.includes("--disable-blink-features=AutomationControlled"));
  assert.ok(args.includes("--lang=en-US"));
  assert.ok(
    args.includes(`--window-size=${profile.screen.width},${profile.screen.height}`)
  );
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
});

test("launch args include proxy-server when proxy is enabled", () => {
  const profile = createFingerprintProfile();
  const args = buildLaunchArgs(profile, {
    USE_PROXY: true,
    PROXY_IP: "127.0.0.1",
    PROXY_PORT: "8080",
  });

  assert.ok(args.includes("--proxy-server=http://127.0.0.1:8080"));
});

test("injection script patches the required browser-visible properties", () => {
  const profile = createFingerprintProfile();
  const script = buildInjectionScript(profile);

  assert.match(script, /navigator, "webdriver"/);
  assert.match(script, /navigator, "language"/);
  assert.match(script, /navigator, "languages"/);
  assert.match(script, /navigator, "platform"/);
  assert.match(script, /navigator, "vendor"/);
  assert.match(script, /hardwareConcurrency/);
  assert.match(script, /deviceMemory/);
  assert.match(script, /Intl\.DateTimeFormat/);
  assert.match(script, /WebGLRenderingContext/);
  assert.match(script, /WebGL2RenderingContext/);
});
