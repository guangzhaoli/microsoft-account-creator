const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

const {
  getOauthScopes,
  getFixedProxyValue,
} = require("./browser/runtime-config");

const AUTHORIZE_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function createPkcePair(deps = {}) {
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const createHash = deps.createHash || crypto.createHash;
  const codeVerifier = toBase64Url(randomBytes(64));
  const codeChallenge = toBase64Url(
    createHash("sha256").update(codeVerifier).digest()
  );

  return {
    codeVerifier,
    codeChallenge,
  };
}

function buildAuthorizeUrl(config, pkce) {
  const params = new URLSearchParams({
    client_id: config.OAUTH2_CLIENT_ID,
    response_type: "code",
    redirect_uri: config.OAUTH2_REDIRECT_URL,
    scope: getOauthScopes(config).join(" "),
    response_mode: "query",
    prompt: "select_account",
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

function createProxyAgents(proxyUrl, deps = {}) {
  if (!proxyUrl) {
    return {
      httpAgent: undefined,
      httpsAgent: undefined,
    };
  }

  const createHttpProxyAgent =
    deps.createHttpProxyAgent || ((url) => new HttpProxyAgent(url));
  const createHttpsProxyAgent =
    deps.createHttpsProxyAgent || ((url) => new HttpsProxyAgent(url));
  const createSocksProxyAgent =
    deps.createSocksProxyAgent || ((url) => new SocksProxyAgent(url));
  const protocol = new URL(proxyUrl).protocol;

  if (protocol === "http:" || protocol === "https:") {
    return {
      httpAgent: createHttpProxyAgent(proxyUrl),
      httpsAgent: createHttpsProxyAgent(proxyUrl),
    };
  }

  if (
    protocol === "socks:" ||
    protocol === "socks4:" ||
    protocol === "socks5:"
  ) {
    const agent = createSocksProxyAgent(proxyUrl);
    return {
      httpAgent: agent,
      httpsAgent: agent,
    };
  }

  throw new Error(`Unsupported OAuth2 proxy protocol: ${protocol}`);
}

function extractAuthorizationCode(callbackUrl) {
  const parsed = new URL(callbackUrl);
  return parsed.searchParams.get("code");
}

async function completeOAuth2(page, email, password, config, deps = {}) {
  const logFn = deps.logFn || (() => {});
  const delayFn = deps.delayFn || defaultDelay;
  const createPkcePairFn = deps.createPkcePair || createPkcePair;
  const exchangeAuthCodeForTokensFn =
    deps.exchangeAuthCodeForTokens || exchangeAuthCodeForTokens;
  const writeOAuthTokensFn = deps.writeOAuthTokens || writeOAuthTokens;

  const pkce = createPkcePairFn();
  const authorizeUrl = buildAuthorizeUrl(config, pkce);
  const redirectCapture = createRedirectCapture(page, config.OAUTH2_REDIRECT_URL, {
    timeout: 120000,
  });

  logFn("Starting OAuth2 authorization...", "yellow");

  try {
    await page.goto(authorizeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (error) {
    const capturedUrl = redirectCapture.getResolvedUrl();
    if (!capturedUrl && !isRedirectUrl(page.url?.(), config.OAUTH2_REDIRECT_URL)) {
      throw error;
    }
  }

  const callbackUrl = await driveOAuth2AuthorizeFlow(page, email, password, {
    delayFn,
    logFn,
    redirectCapture,
    redirectUrl: config.OAUTH2_REDIRECT_URL,
    timeout: 120000,
  });
  const authCode = extractAuthorizationCode(callbackUrl);

  if (!authCode) {
    throw new Error(`OAuth2 callback did not include an authorization code: ${callbackUrl}`);
  }

  logFn("OAuth2 authorization code captured, exchanging tokens...", "yellow");
  const tokens = await exchangeAuthCodeForTokensFn(
    authCode,
    pkce.codeVerifier,
    config,
    deps
  );

  await writeOAuthTokensFn(
    {
      email,
      password,
      clientId: config.OAUTH2_CLIENT_ID,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    },
    config,
    deps
  );

  logFn("OAuth2 tokens saved", "green");
  return tokens;
}

async function driveOAuth2AuthorizeFlow(page, email, password, options = {}) {
  const delayFn = options.delayFn || defaultDelay;
  const logFn = options.logFn || (() => {});
  const redirectCapture = options.redirectCapture;
  const redirectUrl = options.redirectUrl;
  const timeout = options.timeout || 120000;
  const nowFn = options.nowFn || Date.now;
  const deadline = nowFn() + timeout;
  const actionTracker = new Map();

  while (nowFn() < deadline) {
    const capturedUrl = redirectCapture.getResolvedUrl();
    if (capturedUrl) {
      return capturedUrl;
    }

    const currentUrl = typeof page.url === "function" ? page.url() : "";
    if (isRedirectUrl(currentUrl, redirectUrl)) {
      return currentUrl;
    }

    const stateKey = await buildOAuthPageStateKey(page, currentUrl);

    if (
      (await hasSelector(page, ['input[name="loginfmt"]'])) &&
      shouldAttemptOAuthAction(actionTracker, "loginfmt", stateKey, nowFn())
    ) {
      await fillInput(page, ['input[name="loginfmt"]'], email);
      logFn("OAuth2 login prompt detected, submitting email...", "yellow");
      await submitOAuthPrompt(page);
      await delayFn(1000);
      continue;
    }

    if (
      (await hasSelector(page, ['input[name="passwd"]', 'input[type="password"]'])) &&
      shouldAttemptOAuthAction(actionTracker, "password", stateKey, nowFn())
    ) {
      await fillInput(page, ['input[name="passwd"]', 'input[type="password"]'], password);
      logFn("OAuth2 password prompt detected, submitting password...", "yellow");
      await submitOAuthPrompt(page);
      await delayFn(1000);
      continue;
    }

    if (
      (await hasActionByText(page, [email.toLowerCase()], { exact: false })) &&
      shouldAttemptOAuthAction(actionTracker, "account-choice", stateKey, nowFn())
    ) {
      await clickActionByText(page, [email.toLowerCase()], { exact: false });
      logFn("OAuth2 account chooser detected, selecting current account...", "yellow");
      await delayFn(1000);
      continue;
    }

    if (
      (await hasSelector(page, ['[data-testid="appConsentPrimaryButton"]'])) &&
      shouldAttemptOAuthAction(actionTracker, "consent-primary", stateKey, nowFn())
    ) {
      await clickSelector(page, ['[data-testid="appConsentPrimaryButton"]']);
      logFn("OAuth2 consent prompt detected, approving...", "yellow");
      await delayFn(1000);
      continue;
    }

    if (
      (await hasActionByText(page, ["accept", "allow", "continue"], { exact: true })) &&
      shouldAttemptOAuthAction(actionTracker, "consent-text", stateKey, nowFn())
    ) {
      await clickActionByText(page, ["accept", "allow", "continue"], { exact: true });
      logFn("OAuth2 approval action detected, continuing...", "yellow");
      await delayFn(1000);
      continue;
    }

    if (
      (await hasSelector(page, ["#idBtn_Back"])) &&
      shouldAttemptOAuthAction(actionTracker, "stay-signed-in-no", stateKey, nowFn())
    ) {
      await clickSelector(page, ["#idBtn_Back"]);
      logFn("OAuth2 stay-signed-in prompt detected, choosing No...", "yellow");
      await delayFn(1000);
      continue;
    }

    await delayFn(500);
  }

  throw new Error("Timed out while completing the OAuth2 authorization flow");
}

function shouldAttemptOAuthAction(actionTracker, actionName, stateKey, now) {
  const previous = actionTracker.get(actionName);
  if (
    previous &&
    previous.stateKey === stateKey &&
    now - previous.timestamp < 8000
  ) {
    return false;
  }

  actionTracker.set(actionName, {
    stateKey,
    timestamp: now,
  });
  return true;
}

async function exchangeAuthCodeForTokens(authCode, codeVerifier, config, deps = {}) {
  const axiosLib = deps.axiosLib || axios;
  const proxyUrl = getFixedProxyValue(config);
  const agents = (deps.createProxyAgents || createProxyAgents)(proxyUrl, deps);
  const body = new URLSearchParams({
    client_id: config.OAUTH2_CLIENT_ID,
    code: authCode,
    redirect_uri: config.OAUTH2_REDIRECT_URL,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
    scope: getOauthScopes(config).join(" "),
  });
  const response = await axiosLib.post(TOKEN_ENDPOINT, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 30000,
    proxy: false,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
    validateStatus: () => true,
  });

  if (response.status >= 400 || !response.data?.refresh_token) {
    throw new Error(
      `OAuth2 token exchange failed with status ${response.status}: ${JSON.stringify(
        response.data
      )}`
    );
  }

  return {
    refreshToken: response.data.refresh_token,
    accessToken: response.data.access_token || "",
    expiresAt:
      Math.floor(Date.now() / 1000) + Number.parseInt(response.data.expires_in, 10),
    scope: response.data.scope || getOauthScopes(config).join(" "),
  };
}

async function writeOAuthTokens(record, config, deps = {}) {
  const fsLib = deps.fsLib || fs;
  const output = {
    email: record.email,
    password: record.password,
    client_id: record.clientId,
    refresh_token: record.refreshToken,
    access_token: record.accessToken,
    expires_at: record.expiresAt,
    scope: record.scope,
    created_at: new Date().toISOString(),
  };

  const prefix = await getJsonlAppendPrefix(config.OAUTH_TOKENS_FILE, fsLib);
  await fsLib.promises.appendFile(
    config.OAUTH_TOKENS_FILE,
    `${prefix}${JSON.stringify(output)}\n`,
    "utf8"
  );

  const textPrefix = await getJsonlAppendPrefix(config.OAUTH_TOKENS_TEXT_FILE, fsLib);
  await fsLib.promises.appendFile(
    config.OAUTH_TOKENS_TEXT_FILE,
    `${textPrefix}${record.email}----${record.password}----${record.clientId}----${record.refreshToken}\n`,
    "utf8"
  );
}

async function getJsonlAppendPrefix(filePath, fsLib) {
  try {
    const existing = await fsLib.promises.readFile(filePath, "utf8");
    if (!existing) {
      return "";
    }

    return existing.endsWith("\n") ? "" : "\n";
  } catch (error) {
    return "";
  }
}

function createRedirectCapture(page, redirectUrl, options = {}) {
  const timeout = options.timeout || 120000;
  let resolvedUrl = null;
  let timeoutHandle = null;
  let settled = false;
  let rejectPromise = null;
  let resolvePromise = null;

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    if (typeof page.off === "function") {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("framenavigated", onFrameNavigated);
    }
  };

  const maybeResolve = (url) => {
    if (settled || !isRedirectUrl(url, redirectUrl)) {
      return;
    }

    settled = true;
    resolvedUrl = url;
    cleanup();
    resolvePromise(url);
  };

  const onRequest = (request) => maybeResolve(request.url());
  const onResponse = (response) => maybeResolve(response.url());
  const onFrameNavigated = (frame) => maybeResolve(frame.url());

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (typeof page.on === "function") {
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("framenavigated", onFrameNavigated);
  }

  maybeResolve(typeof page.url === "function" ? page.url() : "");

  timeoutHandle = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    rejectPromise(
      new Error(`Timed out waiting for OAuth2 redirect to ${redirectUrl}`)
    );
  }, timeout);

  return {
    promise,
    getResolvedUrl() {
      return resolvedUrl;
    },
  };
}

async function fillInput(page, selectors, value) {
  for (const frame of getPageFrames(page)) {
    for (const selector of selectors) {
      try {
        if (typeof frame.$ !== "function") {
          continue;
        }

        const handle = await frame.$(selector);
        if (!handle) {
          continue;
        }

        if (typeof handle.click === "function") {
          await handle.click({ clickCount: 3 });
        }

        if (typeof handle.evaluate === "function") {
          await handle.evaluate((element) => {
            if ("value" in element) {
              element.value = "";
            }
          });
        }

        if (typeof handle.type === "function") {
          await handle.type(value, { delay: 20 });
        } else if (typeof frame.type === "function") {
          await frame.type(selector, value, { delay: 20 });
        } else {
          continue;
        }

        return true;
      } catch (error) {}
    }
  }

  return false;
}

async function hasSelector(page, selectors) {
  for (const frame of getPageFrames(page)) {
    for (const selector of selectors) {
      try {
        if (typeof frame.$ !== "function") {
          continue;
        }
        const handle = await frame.$(selector);
        if (handle) {
          return true;
        }
      } catch (error) {}
    }
  }

  return false;
}

async function clickSelector(page, selectors) {
  for (const frame of getPageFrames(page)) {
    for (const selector of selectors) {
      try {
        if (typeof frame.$ !== "function") {
          continue;
        }
        const handle = await frame.$(selector);
        if (!handle) {
          continue;
        }
        await handle.click({ delay: 100 });
        return selector;
      } catch (error) {}
    }
  }

  return null;
}

async function submitOAuthPrompt(page) {
  const clicked = await clickSelector(page, [
    "#idSIButton9",
    'button[type="submit"]',
    'input[type="submit"]',
  ]);
  if (clicked) {
    return clicked;
  }

  if (page?.keyboard && typeof page.keyboard.press === "function") {
    await page.keyboard.press("Enter");
    return "Enter";
  }

  return null;
}

async function hasActionByText(page, labels, options = {}) {
  const exact = options.exact !== false;
  const normalizedLabels = labels.map((label) =>
    String(label || "").replace(/\s+/g, " ").trim().toLowerCase()
  );

  for (const frame of getPageFrames(page)) {
    if (typeof frame.$$ !== "function") {
      continue;
    }

    try {
      const handles = await frame.$$(
        'button, input[type="submit"], input[type="button"], a, [role="button"]'
      );

      for (const handle of handles) {
        const text = await handle.evaluate((element) => {
          return String(
            element.innerText ||
              element.textContent ||
              element.getAttribute("value") ||
              element.getAttribute("aria-label") ||
              ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        });

        if (!text) {
          continue;
        }

        const matched = exact
          ? normalizedLabels.includes(text)
          : normalizedLabels.some((label) => text.includes(label));
        if (matched) {
          return true;
        }
      }
    } catch (error) {}
  }

  return false;
}

async function clickActionByText(page, labels, options = {}) {
  const exact = options.exact !== false;
  const normalizedLabels = labels.map((label) =>
    String(label || "").replace(/\s+/g, " ").trim().toLowerCase()
  );

  for (const frame of getPageFrames(page)) {
    if (typeof frame.$$ !== "function") {
      continue;
    }

    try {
      const handles = await frame.$$(
        'button, input[type="submit"], input[type="button"], a, [role="button"]'
      );

      for (const handle of handles) {
        const text = await handle.evaluate((element) => {
          return String(
            element.innerText ||
              element.textContent ||
              element.getAttribute("value") ||
              element.getAttribute("aria-label") ||
              ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        });

        if (!text) {
          continue;
        }

        const matched = exact
          ? normalizedLabels.includes(text)
          : normalizedLabels.some((label) => text.includes(label));
        if (!matched) {
          continue;
        }

        await handle.click({ delay: 100 });
        return text;
      }
    } catch (error) {}
  }

  return null;
}

function getPageFrames(page) {
  if (page && typeof page.frames === "function") {
    return page.frames();
  }

  return [page];
}

async function buildOAuthPageStateKey(page, currentUrl) {
  const markers = [
    (await hasSelector(page, ['input[name="loginfmt"]'])) ? "loginfmt" : "",
    (await hasSelector(page, ['input[name="passwd"]', 'input[type="password"]']))
      ? "password"
      : "",
    (await hasSelector(page, ['[data-testid="appConsentPrimaryButton"]']))
      ? "consent-primary"
      : "",
    (await hasSelector(page, ["#idBtn_Back"])) ? "idBtn_Back" : "",
    (await hasActionByText(page, ["accept", "allow", "continue"], { exact: true }))
      ? "consent-text"
      : "",
    (await hasActionByText(page, ["yes", "no"], { exact: true })) ? "yes-no" : "",
  ].filter(Boolean);

  return `${currentUrl}::${markers.join("|")}`;
}

function isRedirectUrl(url, redirectUrl) {
  return typeof url === "string" && typeof redirectUrl === "string" && url.startsWith(redirectUrl);
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function defaultDelay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

module.exports = {
  AUTHORIZE_ENDPOINT,
  TOKEN_ENDPOINT,
  createPkcePair,
  buildAuthorizeUrl,
  createProxyAgents,
  extractAuthorizationCode,
  driveOAuth2AuthorizeFlow,
  exchangeAuthCodeForTokens,
  writeOAuthTokens,
  completeOAuth2,
};
