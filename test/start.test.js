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
    config: { BROWSER_EXECUTABLE_PATH: "/tmp/chrome", USE_PROXY: false },
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

test("start still closes the session when account creation fails", async () => {
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

  await assert.rejects(
    () =>
      start({
        config: { BROWSER_EXECUTABLE_PATH: "/tmp/chrome", USE_PROXY: false },
        validateRuntimeConfig: () => {},
        createBrowserSession: () => fakeSession,
        createAccount: async () => {
          throw new Error("boom");
        },
        clearConsole: () => {},
      }),
    /boom/
  );

  assert.deepEqual(calls, ["launch", "newPage", "close"]);
});
