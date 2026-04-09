const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
  normalizeCurlProxyUrl,
} = require("../src/browser/fingerprint");

test("launch args include the required anti-automation and locale settings", () => {
  const profile = {
    seed: 424242,
    platform: "macos",
    platformVersion: "15.2.0",
    brand: "Chrome",
    brandVersion: "144.0.7559.132",
    language: "en-US",
    acceptLanguage: "en-US,en",
    timezone: "Asia/Hong_Kong",
    hardwareConcurrency: 8,
    disableNonProxiedUDP: true,
    disableSpoofing: [],
    screen: { width: 1512, height: 982 },
    webgl: { vendor: "Apple Inc.", renderer: "Apple M4" },
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
  assert.ok(args.includes("--timezone=Asia/Hong_Kong"));
  assert.ok(args.includes("--fingerprint=424242"));
  assert.ok(args.includes("--fingerprint-platform=macos"));
  assert.ok(args.includes("--fingerprint-platform-version=15.2.0"));
  assert.ok(args.includes("--fingerprint-brand=Chrome"));
  assert.ok(args.includes("--fingerprint-brand-version=144.0.7559.132"));
  assert.ok(args.includes("--fingerprint-hardware-concurrency=8"));
  assert.ok(args.includes("--disable-non-proxied-udp"));
  assert.ok(
    args.includes(`--window-size=${profile.screen.width},${profile.screen.height}`)
  );
  assert.ok(args.includes("--no-first-run"));
  assert.ok(args.includes("--no-default-browser-check"));
});

test("launch args include proxy-server when proxy is enabled", () => {
  const profile = {
    seed: 424242,
    platform: "macos",
    platformVersion: "15.2.0",
    brand: "Chrome",
    brandVersion: "144.0.7559.132",
    language: "en-US",
    acceptLanguage: "en-US,en",
    timezone: "Asia/Hong_Kong",
    hardwareConcurrency: 8,
    disableNonProxiedUDP: true,
    disableSpoofing: ["gpu", "font"],
    screen: { width: 1512, height: 982 },
    webgl: { vendor: "Apple Inc.", renderer: "Apple M4" },
  };
  const args = buildLaunchArgs(profile, {
    PROXY_MODE: "fixed",
    PROXY: "http://127.0.0.1:8080",
  });

  assert.ok(args.includes("--proxy-server=http://127.0.0.1:8080"));
  assert.ok(args.includes("--disable-spoofing=gpu,font"));
});

test("createFingerprintProfile resolves a macOS Apple M4 persona and proxy timezone", async () => {
  const profile = await createFingerprintProfile(
    {
      BROWSER_EXECUTABLE_PATH:
        "/home/lucas/Downloads/ungoogled-chromium-144.0.7559.132-1-x86_64_linux/chrome",
      PROXY_MODE: "fixed",
      PROXY: "http://127.0.0.1:7890",
    },
    {
      randomInt: () => 424242,
      resolveProxyTimezone: async (config) => {
        assert.equal(config.PROXY, "http://127.0.0.1:7890");
        return "Asia/Hong_Kong";
      },
      availableParallelism: () => 8,
    }
  );

  assert.equal(profile.platform, "macos");
  assert.equal(profile.brand, "Chrome");
  assert.equal(profile.brandVersion, "144.0.7559.132");
  assert.equal(profile.platformVersion, "15.2.0");
  assert.equal(profile.seed, 424242);
  assert.equal(profile.timezone, "Asia/Hong_Kong");
  assert.equal(profile.webgl.vendor, "Apple Inc.");
  assert.equal(profile.webgl.renderer, "Apple M4");
});

test("injection script only keeps the minimal automation patches", () => {
  const profile = {
    webgl: {
      vendor: "Apple Inc.",
      renderer: "Apple M4",
    },
  };
  const script = buildInjectionScript(profile);

  assert.match(script, /navigator, "webdriver"/);
  assert.match(script, /window\.chrome/);
  assert.match(script, /Apple M4/);
  assert.match(script, /WebGLRenderingContext/);
  assert.doesNotMatch(script, /Intl\.DateTimeFormat/);
  assert.doesNotMatch(script, /MacIntel/);
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
