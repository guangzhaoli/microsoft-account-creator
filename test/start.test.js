const test = require("node:test");
const assert = require("node:assert/strict");

const { start } = require("../src/index");

test("start uses BrowserSession and closes it in finally", async () => {
  const calls = [];
  const fakePage = { goto: async () => {} };
  const fakeSession = {
    async launch() {
      calls.push("launch");
    },
    async newPage() {
      calls.push("newPage");
      return fakePage;
    },
    async close() {
      calls.push("close");
    },
  };

  await start({
    config: {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
      COUNTS: 1,
      WORKERS: 1,
    },
    validateRuntimeConfig: () => {},
    createBrowserSession: () => fakeSession,
    createAccount: async (page) => {
      calls.push(["createAccount", page]);
    },
    clearConsole: () => calls.push("clearConsole"),
  });

  assert.deepEqual(calls, [
    "clearConsole",
    "launch",
    "newPage",
    ["createAccount", fakePage],
    "close",
  ]);
});

test("start retries a failed attempt and still closes each session", async () => {
  const calls = [];
  const fakeSession = {
    async launch() {
      calls.push("launch");
    },
    async newPage() {
      calls.push("newPage");
      return {};
    },
    async close() {
      calls.push("close");
    },
  };
  let attempts = 0;

  await start({
    config: {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
      COUNTS: 1,
      WORKERS: 1,
    },
    validateRuntimeConfig: () => {},
    createBrowserSession: () => fakeSession,
    createAccount: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("boom");
      }
    },
    clearConsole: () => {},
    logFn: () => {},
  });

  assert.equal(attempts, 2);
  assert.deepEqual(calls, ["launch", "newPage", "close", "launch", "newPage", "close"]);
});

test("start logs browser launch milestones before registration begins", async () => {
  const logMessages = [];
  const fakeSession = {
    async launch() {},
    async newPage() {
      return {};
    },
    async close() {},
  };

  await start({
    config: {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
      COUNTS: 1,
      WORKERS: 1,
    },
    validateRuntimeConfig: () => {},
    createBrowserSession: () => fakeSession,
    createAccount: async () => {},
    clearConsole: () => {},
    logFn: (message) => logMessages.push(message),
  });

  assert.deepEqual(logMessages, [
    "Starting...",
    "Launching browser...",
    "Browser launched",
    "Browser page ready, starting registration flow...",
  ]);
});

test("start hides the browser window before registration when configured", async () => {
  const calls = [];
  const fakePage = {};
  const fakeSession = {
    async launch() {
      calls.push("launch");
    },
    async newPage() {
      calls.push("newPage");
      return fakePage;
    },
    async close() {
      calls.push("close");
    },
  };

  await start({
    config: {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
      COUNTS: 1,
      WORKERS: 1,
      HIDE_BROWSER_UNTIL_VERIFICATION: true,
    },
    validateRuntimeConfig: () => {},
    createBrowserSession: () => fakeSession,
    createAccount: async () => {
      calls.push("createAccount");
    },
    hideBrowserWindowFn: async (page) => {
      calls.push(["hide", page]);
    },
    clearConsole: () => {},
  });

  assert.deepEqual(calls, [
    "launch",
    "newPage",
    ["hide", fakePage],
    "createAccount",
    "close",
  ]);
});

test("start respects workers while continuing until the target success count is reached", async () => {
  const outcomes = ["fail", "success", "success"];
  const gates = [];
  let attempts = 0;
  let active = 0;
  let maxActive = 0;
  let closedSessions = 0;

  function createDeferred() {
    let resolve;
    const promise = new Promise((resolved) => {
      resolve = resolved;
    });

    return { promise, resolve };
  }

  const runPromise = start({
    config: {
      BROWSER_EXECUTABLE_PATH: "/tmp/chrome",
      PROXY_MODE: "none",
      COUNTS: 2,
      WORKERS: 2,
    },
    validateRuntimeConfig: () => {},
    createBrowserSession: () => ({
      async launch() {},
      async newPage() {
        return {};
      },
      async close() {
        closedSessions += 1;
      },
    }),
    createAccount: async () => {
      const index = attempts;
      attempts += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      const gate = createDeferred();
      gates[index] = gate;
      await gate.promise;
      active -= 1;
      if (outcomes[index] === "fail") {
        throw new Error("boom");
      }
    },
    clearConsole: () => {},
    logFn: () => {},
  });

  await waitFor(() => attempts === 2);
  gates[0].resolve();
  await waitFor(() => attempts === 3);
  gates[1].resolve();
  gates[2].resolve();
  await runPromise;

  assert.equal(attempts, 3);
  assert.equal(maxActive, 2);
  assert.equal(closedSessions, 3);
});

async function waitFor(checkFn, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (checkFn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for test condition");
}
