const fs = require("fs");
const os = require("os");
const path = require("path");
const vanillaPuppeteer = require("puppeteer");
const { addExtra } = require("puppeteer-extra");

const {
  validateRuntimeConfig,
  getProxyCredentials,
} = require("./runtime-config");
const {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
} = require("./fingerprint");

function createPuppeteerExtra(deps = {}) {
  const basePuppeteer = deps.basePuppeteer || vanillaPuppeteer;
  const addExtraFn = deps.addExtra || addExtra;
  return addExtraFn(basePuppeteer);
}

function createBrowserSession(config, deps = {}) {
  const validateConfig = deps.validateRuntimeConfig || validateRuntimeConfig;
  const getFingerprintProfile =
    deps.createFingerprintProfile || createFingerprintProfile;
  const getLaunchArgs = deps.buildLaunchArgs || buildLaunchArgs;
  const getInjectionScript =
    deps.buildInjectionScript || buildInjectionScript;
  const getCredentials = deps.getProxyCredentials || getProxyCredentials;
  const puppeteerLib = deps.puppeteer || createPuppeteerExtra(deps);
  const fsLib = deps.fs || fs;
  const osLib = deps.os || os;
  const pathLib = deps.path || path;

  let browser = null;
  let profileDir = null;
  let injectionScript = "";

  return {
    async launch() {
      validateConfig(config);

      const profile = await getFingerprintProfile(config);
      injectionScript = getInjectionScript(profile);
      profileDir = await fsLib.promises.mkdtemp(
        pathLib.join(osLib.tmpdir(), "ms-account-browser-")
      );

      browser = await puppeteerLib.launch({
        executablePath: config.BROWSER_EXECUTABLE_PATH,
        headless: false,
        userDataDir: profileDir,
        args: getLaunchArgs(profile, config),
      });

      return browser;
    },

    async newPage() {
      if (!browser) {
        throw new Error("Browser session has not been launched");
      }

      const page = await browser.newPage();
      page.setDefaultTimeout(3600000);
      if (injectionScript) {
        await page.evaluateOnNewDocument(injectionScript);
      }

      const credentials = getCredentials(config);
      if (credentials) {
        await page.authenticate(credentials);
      }

      return page;
    },

    async close() {
      if (browser) {
        await browser.close();
        browser = null;
      }

      if (profileDir) {
        await fsLib.promises.rm(profileDir, { recursive: true, force: true });
        profileDir = null;
      }
    },
  };
}

module.exports = {
  createBrowserSession,
  createPuppeteerExtra,
};
