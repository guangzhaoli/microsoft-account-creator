const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const childProcess = require("child_process");
const CDP = require("chrome-remote-interface");

const {
  validateRuntimeConfig,
  getProxyCredentials,
} = require("./runtime-config");
const {
  createFingerprintProfile,
  buildLaunchArgs,
  buildInjectionScript,
} = require("./fingerprint");
const { createPageAdapter } = require("./cdp-page");

const DEFAULT_PAGE_TIMEOUT = 3600000;
const DEVTOOLS_TIMEOUT_MS = 30000;
const BROWSER_EXIT_TIMEOUT_MS = 5000;

function createBrowserSession(config, deps = {}) {
  const validateConfig = deps.validateRuntimeConfig || validateRuntimeConfig;
  const getFingerprintProfile =
    deps.createFingerprintProfile || createFingerprintProfile;
  const getLaunchArgs = deps.buildLaunchArgs || buildLaunchArgs;
  const getInjectionScript =
    deps.buildInjectionScript || buildInjectionScript;
  const getCredentials = deps.getProxyCredentials || getProxyCredentials;
  const createPageAdapterFn = deps.createPageAdapter || createPageAdapter;
  const launchBrowserProcess =
    deps.launchBrowserProcess || defaultLaunchBrowserProcess;
  const waitForDevToolsEndpoint =
    deps.waitForDevToolsEndpoint || defaultWaitForDevToolsEndpoint;
  const connectBrowserClient =
    deps.connectBrowserClient || defaultConnectBrowserClient;
  const terminateBrowserProcess =
    deps.terminateBrowserProcess || defaultTerminateBrowserProcess;
  const cdp = deps.cdp || CDP;
  const fsLib = deps.fs || fs;
  const osLib = deps.os || os;
  const pathLib = deps.path || path;

  let browserProcess = null;
  let browserClient = null;
  let activePage = null;
  let profileDir = null;
  let browserPort = null;
  let injectionScript = "";

  return {
    async launch() {
      validateConfig(config);

      const profile = await getFingerprintProfile(config);
      injectionScript = getInjectionScript(profile);
      profileDir = await fsLib.promises.mkdtemp(
        pathLib.join(osLib.tmpdir(), "ms-account-browser-")
      );

      const args = buildBrowserSpawnArgs(
        profileDir,
        getLaunchArgs(profile, config)
      );
      browserProcess = await launchBrowserProcess(
        config.BROWSER_EXECUTABLE_PATH,
        args,
        deps
      );

      const endpoint = await waitForDevToolsEndpoint(profileDir, {
        ...deps,
        fs: fsLib,
        path: pathLib,
        browserProcess,
        timeout: DEVTOOLS_TIMEOUT_MS,
      });
      browserPort = endpoint.port;
      browserClient = await connectBrowserClient(endpoint, { ...deps, cdp });

      return {
        port: browserPort,
        browserClient,
      };
    },

    async newPage() {
      if (!browserClient || !browserPort) {
        throw new Error("Browser session has not been launched");
      }

      const page = await createPageAdapterFn({
        ...deps,
        cdp,
        port: browserPort,
        browserClient,
        injectionScript,
      });
      page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT);

      const credentials = getCredentials(config);
      if (credentials) {
        await page.authenticate(credentials);
      }

      activePage = page;
      return page;
    },

    async close() {
      if (activePage && typeof activePage.close === "function") {
        await activePage.close();
        activePage = null;
      }

      if (browserClient) {
        try {
          if (
            browserClient.Browser &&
            typeof browserClient.Browser.close === "function"
          ) {
            await browserClient.Browser.close();
          }
        } catch (error) {}

        try {
          await browserClient.close();
        } catch (error) {}
        browserClient = null;
      }

      if (browserProcess) {
        await terminateBrowserProcess(browserProcess, deps);
        browserProcess = null;
      }

      if (profileDir) {
        await fsLib.promises.rm(profileDir, { recursive: true, force: true });
        profileDir = null;
      }
    },
  };
}

function buildBrowserSpawnArgs(profileDir, launchArgs) {
  return [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    ...launchArgs,
    "about:blank",
  ];
}

function defaultLaunchBrowserProcess(executablePath, args) {
  return new Promise((resolve, reject) => {
    const browserProcess = childProcess.spawn(executablePath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let settled = false;
    browserProcess.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
    browserProcess.once("spawn", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(browserProcess);
    });
  });
}

async function defaultWaitForDevToolsEndpoint(profileDir, deps = {}) {
  const fsLib = deps.fs || fs;
  const pathLib = deps.path || path;
  const timeout = deps.timeout || DEVTOOLS_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  const portFile = pathLib.join(profileDir, "DevToolsActivePort");

  while (Date.now() < deadline) {
    if (deps.browserProcess?.exitCode !== null) {
      throw new Error("Browser exited before DevTools endpoint was ready");
    }

    try {
      const contents = await fsLib.promises.readFile(portFile, "utf8");
      const [rawPort] = String(contents).split(/\r?\n/);
      const port = Number.parseInt(rawPort, 10);
      if (Number.isInteger(port) && port > 0) {
        const version = await fetchJson(
          `http://127.0.0.1:${port}/json/version`
        );
        return {
          port,
          browserWebSocketUrl: version.webSocketDebuggerUrl,
        };
      }
    } catch (error) {}

    await delay(100);
  }

  throw new Error("Timed out waiting for the browser DevTools endpoint");
}

async function defaultConnectBrowserClient(endpoint, deps = {}) {
  const cdp = deps.cdp || CDP;
  return cdp({
    target: endpoint.browserWebSocketUrl,
  });
}

async function defaultTerminateBrowserProcess(browserProcess) {
  if (!browserProcess || browserProcess.exitCode !== null) {
    return;
  }

  browserProcess.kill("SIGTERM");
  const exited = await waitForProcessExit(browserProcess, BROWSER_EXIT_TIMEOUT_MS);
  if (exited) {
    return;
  }

  try {
    browserProcess.kill("SIGKILL");
  } catch (error) {}
  await waitForProcessExit(browserProcess, 1000);
}

function waitForProcessExit(browserProcess, timeout) {
  return new Promise((resolve) => {
    if (!browserProcess || browserProcess.exitCode !== null) {
      resolve(true);
      return;
    }

    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      browserProcess.off("exit", onExit);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    browserProcess.once("exit", onExit);
  });
}

function fetchJson(urlString) {
  const transport = urlString.startsWith("https://") ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(urlString, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

module.exports = {
  createBrowserSession,
  buildBrowserSpawnArgs,
};
