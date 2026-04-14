const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
  normalizeCurlProxyUrl,
  resolveSystemLinuxPlatformVersion,
  resolveRandomScreen,
} = require("../src/browser/fingerprint");

test("launch args include the required anti-automation and locale settings", () => {
  const profile = {
    language: "en-US",
    acceptLanguage: "en-US,en",
    screen: { width: 1512, height: 982 },
  };
  const args = buildLaunchArgs(profile, { PROXY_MODE: "none" });

  assert.ok(args.includes("--disable-blink-features=AutomationControlled"));
  assert.ok(args.includes("--disable-background-networking"));
  assert.ok(args.includes("--disable-renderer-backgrounding"));
  assert.ok(
    args.includes(
      "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication"
    )
  );
  assert.ok(args.includes("--lang=en-US"));
  assert.ok(args.includes("--accept-lang=en-US,en"));
  assert.ok(
    args.includes(`--window-size=${profile.screen.width},${profile.screen.height}`)
  );
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
  assert.ok(!args.some((arg) => arg.startsWith("--fingerprint")));
  assert.ok(!args.some((arg) => arg.startsWith("--timezone=")));
  assert.ok(!args.some((arg) => arg.startsWith("--disable-spoofing=")));
});

test("launch args include proxy-server when proxy is enabled", () => {
  const profile = {
    language: "en-US",
    acceptLanguage: "en-US,en",
    screen: { width: 1512, height: 982 },
  };
  const args = buildLaunchArgs(profile, {
    PROXY_MODE: "fixed",
    PROXY: "http://127.0.0.1:8080",
  });

  assert.ok(args.includes("--proxy-server=http://127.0.0.1:8080"));
});

test("createFingerprintProfile resolves a Linux Ubuntu persona and proxy timezone", async () => {
  const profile = await createFingerprintProfile(
    {
      BROWSER_EXECUTABLE_PATH:
        "/home/lucas/Downloads/ungoogled-chromium-144.0.7559.132-1-x86_64_linux/chrome",
      PROXY_MODE: "fixed",
      PROXY: "http://127.0.0.1:7890",
    },
    {
      randomInt: () => 424242,
      readFileSync: () => 'VERSION="24.04.4 LTS (Noble Numbat)"\nVERSION_ID="24.04"\n',
      resolveProxyTimezone: async (config) => {
        assert.equal(config.PROXY, "http://127.0.0.1:7890");
        return "Asia/Hong_Kong";
      },
      availableParallelism: () => 8,
    }
  );

  assert.equal(profile.platform, "linux");
  assert.equal(profile.brand, "Chrome");
  assert.equal(profile.brandVersion, "144.0.7559.132");
  assert.equal(profile.platformVersion, "24.04.4");
  assert.equal(profile.seed, 424242);
  assert.equal(profile.timezone, "Asia/Hong_Kong");
  assert.equal(profile.webgl.vendor, "Google Inc. (Mesa)");
  assert.equal(profile.webgl.renderer, "ANGLE (Mesa, Vulkan 1.3)");
});

test("injection script is disabled", () => {
  assert.equal(buildInjectionScript({}), "");
});

test("resolveSystemLinuxPlatformVersion reads Ubuntu version from os-release", () => {
  assert.equal(
    resolveSystemLinuxPlatformVersion(
      () =>
        'PRETTY_NAME="Ubuntu 24.04.4 LTS"\nVERSION="24.04.4 LTS (Noble Numbat)"\nVERSION_ID="24.04"\n'
    ),
    "24.04.4"
  );
});

test("resolveRandomScreen picks a common desktop window size", () => {
  assert.deepEqual(resolveRandomScreen(() => 0), {
    width: 1366,
    height: 768,
  });
  assert.deepEqual(resolveRandomScreen(() => 7), {
    width: 1920,
    height: 1080,
  });
});

test("normalizeCurlProxyUrl upgrades socks proxies to socks5h for timezone lookups", () => {
  assert.equal(
    normalizeCurlProxyUrl("socks5://127.0.0.1:20001"),
    "socks5h://127.0.0.1:20001"
  );
  assert.equal(
    normalizeCurlProxyUrl("http://127.0.0.1:7890"),
    "http://127.0.0.1:7890"
  );
});
