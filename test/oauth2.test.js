const test = require("node:test");
const assert = require("node:assert/strict");

const {
  driveOAuth2AuthorizeFlow,
  writeOAuthTokens,
  exchangeAuthCodeForTokens,
} = require("../src/oauth2");

test("driveOAuth2AuthorizeFlow does not resubmit the password on the same unchanged page state", async () => {
  const actions = [];

  const passwordHandle = {
    async click() {
      actions.push(["password.click"]);
    },
    async evaluate(fn) {
      return fn({
        innerText: "",
        textContent: "",
        getAttribute(name) {
          if (name === "value") {
            return "";
          }
          return "";
        },
        value: "",
      });
    },
    async type(value) {
      actions.push(["password.type", value]);
    },
  };

  const submitHandle = {
    async click() {
      actions.push(["submit.click"]);
    },
    async evaluate(fn) {
      return fn({
        innerText: "Next",
        textContent: "Next",
        getAttribute() {
          return "";
        },
      });
    },
  };

  const page = {
    url() {
      return "https://login.live.com/password";
    },
    frames() {
      return [this];
    },
    async $(selector) {
      if (
        selector === 'input[name="passwd"]' ||
        selector === 'input[type="password"]'
      ) {
        return passwordHandle;
      }

      if (selector === "#idSIButton9") {
        return submitHandle;
      }

      return null;
    },
    async $$(selector) {
      if (
        selector === 'button, input[type="submit"], input[type="button"], a, [role="button"]'
      ) {
        return [submitHandle];
      }

      return [];
    },
    async evaluate() {
      return {
        title: "Sign in",
        bodyText: "enter password",
      };
    },
  };

  await assert.rejects(
    () =>
      driveOAuth2AuthorizeFlow(page, "user@hotmail.com", "secret!", {
        delayFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
        },
        logFn: () => {},
        redirectCapture: {
          getResolvedUrl() {
            return null;
          },
        },
        redirectUrl: "http://localhost:5173",
        timeout: 20,
      }),
    /Timed out while completing the OAuth2 authorization flow/
  );

  assert.deepEqual(
    actions.filter((entry) => entry[0] === "password.type"),
    [["password.type", "secret!"]]
  );
});

test("driveOAuth2AuthorizeFlow falls back to Enter when the password page has no clickable Next button", async () => {
  const actions = [];

  const passwordHandle = {
    async click() {
      actions.push(["password.click"]);
    },
    async evaluate(fn) {
      return fn({
        innerText: "",
        textContent: "",
        getAttribute(name) {
          if (name === "value") {
            return "";
          }
          return "";
        },
        value: "",
      });
    },
    async type(value) {
      actions.push(["password.type", value]);
    },
  };

  const page = {
    keyboard: {
      async press(key) {
        actions.push(["page.keyboard.press", key]);
      },
    },
    url() {
      return "https://login.live.com/password";
    },
    frames() {
      return [this];
    },
    async $(selector) {
      if (
        selector === 'input[name="passwd"]' ||
        selector === 'input[type="password"]'
      ) {
        return passwordHandle;
      }

      return null;
    },
    async $$(selector) {
      if (
        selector === 'button, input[type="submit"], input[type="button"], a, [role="button"]'
      ) {
        return [];
      }

      return [];
    },
    async evaluate() {
      return {
        title: "Sign in",
        bodyText: "enter password",
      };
    },
  };

  await assert.rejects(
    () =>
      driveOAuth2AuthorizeFlow(page, "user@hotmail.com", "secret!", {
        delayFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
        },
        logFn: () => {},
        redirectCapture: {
          getResolvedUrl() {
            return null;
          },
        },
        redirectUrl: "http://localhost:5173",
        timeout: 20,
      }),
    /Timed out while completing the OAuth2 authorization flow/
  );

  assert.equal(
    actions.some(
      (entry) => entry[0] === "page.keyboard.press" && entry[1] === "Enter"
    ),
    true
  );
});

test("writeOAuthTokens includes client_id in the saved JSONL record", async () => {
  const writes = [];

  await writeOAuthTokens(
    {
      email: "user@hotmail.com",
      password: "secret!",
      clientId: "client-123",
      refreshToken: "refresh-123",
      accessToken: "access-123",
      expiresAt: 1234567890,
      scope: "offline_access User.Read",
    },
    {
      OAUTH_TOKENS_FILE: "/tmp/oauth_tokens.jsonl",
      OAUTH_TOKENS_TEXT_FILE: "/tmp/oauth_tokens.txt",
    },
    {
      fsLib: {
        promises: {
          appendFile: async (path, payload, encoding) => {
            writes.push({ path, payload, encoding });
          },
        },
      },
    }
  );

  assert.equal(writes.length, 2);
  const jsonWrite = writes.find((entry) =>
    entry.path.endsWith("oauth_tokens.jsonl")
  );
  const record = JSON.parse(jsonWrite.payload.trim());
  assert.equal(record.client_id, "client-123");
  assert.equal(record.email, "user@hotmail.com");
  assert.equal(record.password, "secret!");
  assert.equal(record.refresh_token, "refresh-123");
});

test("writeOAuthTokens inserts a newline separator when the existing file does not end with one", async () => {
  let fileContent = '{"email":"old@hotmail.com"}';

  await writeOAuthTokens(
    {
      email: "user@hotmail.com",
      password: "secret!",
      clientId: "client-123",
      refreshToken: "refresh-123",
      accessToken: "access-123",
      expiresAt: 1234567890,
      scope: "offline_access User.Read",
    },
    {
      OAUTH_TOKENS_FILE: "/tmp/oauth_tokens.jsonl",
      OAUTH_TOKENS_TEXT_FILE: "/tmp/oauth_tokens.txt",
    },
    {
      fsLib: {
        promises: {
          readFile: async () => fileContent,
          appendFile: async (_path, payload) => {
            fileContent += payload;
          },
        },
      },
    }
  );

  assert.equal(fileContent.includes('}\n{"email":"user@hotmail.com"'), true);
});

test("writeOAuthTokens also appends the plain text token format", async () => {
  const writes = [];

  await writeOAuthTokens(
    {
      email: "user@hotmail.com",
      password: "secret!",
      clientId: "client-123",
      refreshToken: "refresh-123",
      accessToken: "access-123",
      expiresAt: 1234567890,
      scope: "offline_access User.Read",
    },
    {
      OAUTH_TOKENS_FILE: "/tmp/oauth_tokens.jsonl",
      OAUTH_TOKENS_TEXT_FILE: "/tmp/oauth_tokens.txt",
    },
    {
      fsLib: {
        promises: {
          readFile: async () => "",
          appendFile: async (path, payload, encoding) => {
            writes.push({ path, payload, encoding });
          },
        },
      },
    }
  );

  assert.equal(writes.length, 2);
  assert.equal(
    writes[1].payload,
    "user@hotmail.com----secret!----client-123----refresh-123\n"
  );
});

test("exchangeAuthCodeForTokens routes socks proxies through custom agents", async () => {
  const calls = [];
  const fakeAgent = { kind: "agent" };

  const tokens = await exchangeAuthCodeForTokens(
    "auth-code",
    "verifier",
    {
      OAUTH2_CLIENT_ID: "client-123",
      OAUTH2_REDIRECT_URL: "http://localhost:5173",
      OAUTH2_SCOPES: ["offline_access"],
      PROXY_MODE: "fixed",
      PROXY: "socks5://127.0.0.1:20001",
    },
    {
      axiosLib: {
        post: async (url, body, options) => {
          calls.push({ url, body, options });
          return {
            status: 200,
            data: {
              refresh_token: "refresh-123",
              access_token: "access-123",
              expires_in: "3600",
              scope: "offline_access",
            },
          };
        },
      },
      createProxyAgents: (proxyUrl) => {
        assert.equal(proxyUrl, "socks5://127.0.0.1:20001");
        return {
          httpAgent: fakeAgent,
          httpsAgent: fakeAgent,
        };
      },
    }
  );

  assert.equal(tokens.refreshToken, "refresh-123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.proxy, false);
  assert.equal(calls[0].options.httpAgent, fakeAgent);
  assert.equal(calls[0].options.httpsAgent, fakeAgent);
});
