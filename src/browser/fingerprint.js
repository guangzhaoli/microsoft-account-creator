const { buildProxyServerArg } = require("./runtime-config");

function createFingerprintProfile() {
  return {
    language: "en-US",
    languages: ["en-US", "en"],
    timezone: "America/Los_Angeles",
    navigator: {
      platform: "MacIntel",
      vendor: "Google Inc.",
      hardwareConcurrency: 8,
      deviceMemory: 8,
    },
    screen: {
      width: 1512,
      height: 982,
      availWidth: 1512,
      availHeight: 957,
      colorDepth: 24,
    },
    webgl: {
      vendor: "Apple Inc.",
      renderer: "Apple M3",
    },
  };
}

function buildLaunchArgs(profile, config) {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    `--lang=${profile.language}`,
    `--window-size=${profile.screen.width},${profile.screen.height}`,
  ];

  const proxyServer = buildProxyServerArg(config);
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`);
  }

  return args;
}

function buildInjectionScript(profile) {
  const payload = JSON.stringify(profile);

  return `(function() {
    const profile = ${payload};
    const defineGetter = (object, key, getter) => {
      if (!object) {
        return;
      }
      try {
        Object.defineProperty(object, key, { get: getter, configurable: true });
      } catch (error) {}
    };

    defineGetter(navigator, "webdriver", () => undefined);
    defineGetter(navigator, "language", () => profile.language);
    defineGetter(navigator, "languages", () => profile.languages.slice());
    defineGetter(navigator, "platform", () => profile.navigator.platform);
    defineGetter(navigator, "vendor", () => profile.navigator.vendor);
    defineGetter(navigator, "hardwareConcurrency", () => profile.navigator.hardwareConcurrency);
    defineGetter(navigator, "deviceMemory", () => profile.navigator.deviceMemory);

    defineGetter(screen, "width", () => profile.screen.width);
    defineGetter(screen, "height", () => profile.screen.height);
    defineGetter(screen, "availWidth", () => profile.screen.availWidth);
    defineGetter(screen, "availHeight", () => profile.screen.availHeight);
    defineGetter(screen, "colorDepth", () => profile.screen.colorDepth);
    defineGetter(screen, "pixelDepth", () => profile.screen.colorDepth);

    const patchWebGL = (Ctor) => {
      if (!Ctor || !Ctor.prototype || typeof Ctor.prototype.getParameter !== "function") {
        return;
      }

      const originalGetParameter = Ctor.prototype.getParameter;
      Ctor.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          return profile.webgl.vendor;
        }
        if (parameter === 37446) {
          return profile.webgl.renderer;
        }
        return originalGetParameter.apply(this, arguments);
      };
    };

    patchWebGL(window.WebGLRenderingContext);
    patchWebGL(window.WebGL2RenderingContext);

    if (Intl.DateTimeFormat && Intl.DateTimeFormat.prototype) {
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function() {
        const output = originalResolvedOptions.apply(this, arguments);
        return { ...output, timeZone: profile.timezone };
      };
    }
  })();`;
}

module.exports = {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
};
