const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const childProcess = require("child_process");

const {
  buildProxyServerArg,
  getProxyCredentials,
} = require("./runtime-config");

const COMMON_SCREEN_SIZES = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 1680, height: 1050 },
  { width: 1728, height: 1117 },
  { width: 1792, height: 1120 },
  { width: 1920, height: 1080 },
];
const DEFAULT_LOOKUP_URL = "https://ipwho.is/";
const proxyTimezoneCache = new Map();

async function createFingerprintProfile(config = {}, deps = {}) {
  const randomInt = deps.randomInt || crypto.randomInt;
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const availableParallelism =
    deps.availableParallelism ||
    (typeof os.availableParallelism === "function"
      ? () => os.availableParallelism()
      : null);
  const cpuCount = deps.cpuCount || (() => os.cpus().length);
  const execFileSync = deps.execFileSync || childProcess.execFileSync;
  const resolveProxyTimezoneFn =
    deps.resolveProxyTimezone || resolveProxyTimezone;
  const timeZone =
    deps.timeZone ||
    (() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  return {
    seed: resolveFingerprintSeed(config, randomInt),
    platform: resolveFingerprintPlatform(config),
    platformVersion: resolveFingerprintPlatformVersion(config, readFileSync),
    brand: resolveFingerprintBrand(config),
    brandVersion: resolveBrowserVersion(config.BROWSER_EXECUTABLE_PATH, execFileSync),
    language: resolveFingerprintLanguage(config),
    acceptLanguage: resolveFingerprintAcceptLanguage(config),
    timezone: await resolveFingerprintTimezone(config, {
      resolveProxyTimezoneFn,
      timeZone,
    }),
    hardwareConcurrency: resolveHardwareConcurrency(
      availableParallelism,
      cpuCount
    ),
    disableNonProxiedUDP: true,
    disableSpoofing: normalizeDisableSpoofing(config.FINGERPRINT_DISABLE_SPOOFING),
    screen: resolveRandomScreen(randomInt),
    webgl: {
      vendor: resolveFingerprintWebGLVendor(config),
      renderer: resolveFingerprintWebGLRenderer(config),
    },
  };
}

function resolveFingerprintSeed(config, randomInt) {
  if (Number.isInteger(config?.FINGERPRINT_SEED) && config.FINGERPRINT_SEED > 0) {
    return config.FINGERPRINT_SEED;
  }

  return randomInt(1, 0x1_0000_0000);
}

function resolveFingerprintPlatform(config) {
  if (
    typeof config?.FINGERPRINT_PLATFORM === "string" &&
    config.FINGERPRINT_PLATFORM.trim() !== ""
  ) {
    return config.FINGERPRINT_PLATFORM.trim();
  }

  return "linux";
}

function resolveFingerprintPlatformVersion(config, readFileSync) {
  if (
    typeof config?.FINGERPRINT_PLATFORM_VERSION === "string" &&
    config.FINGERPRINT_PLATFORM_VERSION.trim() !== ""
  ) {
    return config.FINGERPRINT_PLATFORM_VERSION.trim();
  }

  return resolveSystemLinuxPlatformVersion(readFileSync);
}

function resolveFingerprintBrand(config) {
  if (
    typeof config?.FINGERPRINT_BRAND === "string" &&
    config.FINGERPRINT_BRAND.trim() !== ""
  ) {
    return config.FINGERPRINT_BRAND.trim();
  }

  return "Chrome";
}

function resolveFingerprintLanguage(config) {
  if (
    typeof config?.FINGERPRINT_LANGUAGE === "string" &&
    config.FINGERPRINT_LANGUAGE.trim() !== ""
  ) {
    return config.FINGERPRINT_LANGUAGE.trim();
  }

  return "en-US";
}

function resolveFingerprintAcceptLanguage(config) {
  if (
    typeof config?.FINGERPRINT_ACCEPT_LANGUAGE === "string" &&
    config.FINGERPRINT_ACCEPT_LANGUAGE.trim() !== ""
  ) {
    return config.FINGERPRINT_ACCEPT_LANGUAGE.trim();
  }

  return "en-US,en";
}

function resolveFingerprintWebGLVendor(config) {
  if (
    typeof config?.FINGERPRINT_WEBGL_VENDOR === "string" &&
    config.FINGERPRINT_WEBGL_VENDOR.trim() !== ""
  ) {
    return config.FINGERPRINT_WEBGL_VENDOR.trim();
  }

  return "Google Inc. (Mesa)";
}

function resolveFingerprintWebGLRenderer(config) {
  if (
    typeof config?.FINGERPRINT_WEBGL_RENDERER === "string" &&
    config.FINGERPRINT_WEBGL_RENDERER.trim() !== ""
  ) {
    return config.FINGERPRINT_WEBGL_RENDERER.trim();
  }

  return "ANGLE (Mesa, Vulkan 1.3)";
}

function resolveSystemLinuxPlatformVersion(readFileSync) {
  try {
    const osRelease = String(readFileSync("/etc/os-release", "utf8"));
    const versionMatch = osRelease.match(/^VERSION="?([0-9]+(?:\.[0-9]+)+)/m);
    if (versionMatch) {
      return versionMatch[1];
    }

    const versionIdMatch = osRelease.match(/^VERSION_ID="?([0-9]+(?:\.[0-9]+)*)"?$/m);
    if (versionIdMatch) {
      return versionIdMatch[1];
    }
  } catch (error) {}

  return "";
}

async function resolveFingerprintTimezone(config, deps = {}) {
  if (
    typeof config?.FINGERPRINT_TIMEZONE === "string" &&
    config.FINGERPRINT_TIMEZONE.trim() !== ""
  ) {
    return config.FINGERPRINT_TIMEZONE.trim();
  }

  const proxyServer = buildProxyServerArg(config);
  if (proxyServer) {
    return deps.resolveProxyTimezoneFn(config);
  }

  return deps.timeZone();
}

function resolveBrowserVersion(executablePath, execFileSync) {
  if (typeof executablePath !== "string" || executablePath.trim() === "") {
    return "";
  }

  try {
    const output = execFileSync(executablePath, ["--version"], {
      encoding: "utf8",
    });
    const match = String(output).match(/([0-9]+(?:\.[0-9]+)+)/);
    if (match) {
      return match[1];
    }
  } catch (error) {}

  return "";
}

function resolveHardwareConcurrency(availableParallelism, cpuCount) {
  if (typeof availableParallelism === "function") {
    const value = availableParallelism();
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }

  const cpus = cpuCount();
  if (Number.isInteger(cpus) && cpus > 0) {
    return cpus;
  }

  return 8;
}

function normalizeDisableSpoofing(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function resolveRandomScreen(randomInt) {
  const index = randomInt(0, COMMON_SCREEN_SIZES.length);
  return { ...COMMON_SCREEN_SIZES[index] };
}

async function resolveProxyTimezone(config, deps = {}) {
  const proxyServer = buildProxyServerArg(config);
  if (!proxyServer) {
    throw new Error("Proxy timezone resolution requires PROXY_MODE=fixed");
  }

  if (proxyTimezoneCache.has(proxyServer)) {
    return proxyTimezoneCache.get(proxyServer);
  }

  const execFile = deps.execFile || childProcess.execFile;
  const lookupUrl = deps.lookupUrl || DEFAULT_LOOKUP_URL;
  const proxyCredentials = getProxyCredentials(config);
  const proxyForCurl = normalizeCurlProxyUrl(proxyServer);
  const args = ["-sS", "--max-time", "10", "--proxy", proxyForCurl, lookupUrl];
  if (proxyCredentials) {
    args.splice(
      args.length - 1,
      0,
      "--proxy-user",
      `${proxyCredentials.username}:${proxyCredentials.password}`
    );
  }

  const stdout = await new Promise((resolve, reject) => {
    execFile("curl", args, { encoding: "utf8" }, (error, output) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(output);
    });
  });

  let payload;
  try {
    payload = JSON.parse(String(stdout));
  } catch (error) {
    throw new Error(`Failed to parse proxy timezone lookup response: ${error.message}`);
  }

  const timezone = payload?.timezone?.id;
  if (typeof timezone !== "string" || timezone.trim() === "") {
    throw new Error("Proxy timezone lookup did not return a timezone id");
  }

  proxyTimezoneCache.set(proxyServer, timezone.trim());
  return timezone.trim();
}

function normalizeCurlProxyUrl(proxyUrl) {
  if (typeof proxyUrl !== "string") {
    return proxyUrl;
  }

  if (proxyUrl.startsWith("socks5://")) {
    return proxyUrl.replace("socks5://", "socks5h://");
  }

  if (proxyUrl.startsWith("socks://")) {
    return proxyUrl.replace("socks://", "socks5h://");
  }

  return proxyUrl;
}

function buildLaunchArgs(profile, config) {
  const args = [
    "--disable-background-networking",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication",
    "--disable-popup-blocking",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
    `--lang=${profile.language}`,
    `--accept-lang=${profile.acceptLanguage}`,
    `--window-size=${profile.screen.width},${profile.screen.height}`,
  ];

  const proxyServer = buildProxyServerArg(config);
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  return args;
}

function buildInjectionScript(profile = {}) {
  return "";
}

module.exports = {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
  resolveProxyTimezone,
  normalizeCurlProxyUrl,
  resolveSystemLinuxPlatformVersion,
  resolveRandomScreen,
};
