const test = require("node:test");
const assert = require("node:assert/strict");

const { createAccount } = require("../src/index");

function buildFakePage() {
  return {
    keyboard: {
      async press() {},
    },
    async goto() {},
    async waitForSelector() {},
    async type() {},
    async select() {},
    async $eval() {
      return "user@example.com";
    },
    async waitForFunction(fn, options, arg) {
      if (Array.isArray(arg)) {
        throw new Error("text challenge not present");
      }
    },
    async click() {},
    async $() {
      return null;
    },
  };
}

test("createAccount logs progress through the pre-captcha registration stages", async () => {
  const logMessages = [];
  const page = buildFakePage();

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: (message) => logMessages.push(message),
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.deepEqual(logMessages, [
    "Opening Outlook signup page...",
    "Signup page ready, generating personal info...",
    "Submitting username...",
    "Submitting password...",
    "Submitting first and last name...",
    "Submitting birth date...",
    "Birth date submitted, waiting for captcha challenge...",
    "Please solve the captcha",
    "Captcha Solved!",
    "Waiting for post-login landing page...",
  ]);
});

test("createAccount fails fast when signup redirects away before username step", async () => {
  const page = {
    async goto() {},
    async waitForSelector(selector) {
      if (
        selector === "#usernameInput" ||
        selector === "#floatingLabelInput4"
      ) {
        throw new Error("timeout");
      }
    },
    url() {
      return "https://outlook.live.com/mail/";
    },
  };

  await assert.rejects(
    () =>
      createAccount(
        page,
        {
          ADD_RECOVERY_EMAIL: false,
          ACCOUNTS_FILE: "/tmp/accounts.txt",
          NAMES_FILE: "src/Utils/names.txt",
          WORDS_FILE: "src/Utils/words5char.txt",
        },
        {
          logFn: () => {},
        }
      ),
    /Signup page did not reach username step\. Current URL: https:\/\/outlook\.live\.com\/mail\//
  );
});

test("createAccount supports the modern Microsoft signup flow before captcha", async () => {
  const actions = [];
  const page = {
    keyboard: {
      async press(key) {
        actions.push(["press", key]);
      },
    },
    async goto(url) {
      actions.push(["goto", url]);
    },
    async waitForSelector(selector) {
      actions.push(["waitForSelector", selector]);
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
        "#mainApp",
      ]);
      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }
      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type(selector, value) {
      actions.push(["type", selector, value]);
    },
    async focus(selector) {
      actions.push(["focus", selector]);
    },
    async $eval() {
      return "unused@example.com";
    },
    async waitForFunction(fn, options, arg) {
      actions.push(["waitForFunction", arg]);
      if (Array.isArray(arg)) {
        throw new Error("text challenge not present");
      }
    },
    async click(selector) {
      actions.push(["click", selector]);
    },
    async $() {
      return null;
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      handleModernVerificationFn: async () => {
        actions.push(["handleModernVerification"]);
      },
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.deepEqual(
    actions.filter((entry) => ["goto", "type", "focus"].includes(entry[0])),
    [
      ["goto", "https://signup.live.com/signup"],
      ["type", "#floatingLabelInput4", "testuser123@hotmail.com"],
      ["type", 'input[type=\"password\"]', "secret123!"],
      ["focus", "#BirthMonthDropdown"],
      ["focus", "#BirthDayDropdown"],
      ["type", "#floatingLabelInput24", "1995"],
      ["type", "#firstNameInput", "Mario"],
      ["type", "#lastNameInput", "Rossi"],
    ]
  );
});

test("createAccount runs the OAuth2 flow after post-login landing when enabled", async () => {
  const actions = [];
  const page = {
    keyboard: {
      async press(key) {
        actions.push(["press", key]);
      },
    },
    async goto(url) {
      actions.push(["goto", url]);
    },
    async waitForSelector(selector) {
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
      ]);
      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }
      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type(selector, value) {
      actions.push(["type", selector, value]);
    },
    async focus(selector) {
      actions.push(["focus", selector]);
    },
    async click(selector) {
      actions.push(["click", selector]);
    },
    async $() {
      return null;
    },
    async $eval() {
      return "unused@example.com";
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ENABLE_OAUTH2: true,
      OAUTH2_CLIENT_ID: "client-id",
      OAUTH2_REDIRECT_URL: "http://localhost:8000/callback",
      OAUTH2_SCOPES: ["offline_access"],
      OAUTH_TOKENS_FILE: "/tmp/oauth_tokens.jsonl",
      OAUTH_TOKENS_TEXT_FILE: "/tmp/oauth_tokens.txt",
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      handleModernVerificationFn: async () => {},
      completeOAuth2Fn: async (pageArg, email, password) => {
        actions.push(["oauth2", pageArg === page, email, password]);
      },
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.equal(
    actions.some(
      (entry) =>
        entry[0] === "oauth2" &&
        entry[1] === true &&
        entry[2] === "testuser123@hotmail.com" &&
        entry[3] === "secret123!"
    ),
    true
  );
});

test("createAccount shows the browser for manual verification and hides it afterward", async () => {
  const actions = [];
  const page = {
    keyboard: {
      async press(key) {
        actions.push(["press", key]);
      },
    },
    async goto(url) {
      actions.push(["goto", url]);
    },
    async waitForSelector(selector) {
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
      ]);
      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }
      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type(selector, value) {
      actions.push(["type", selector, value]);
    },
    async focus(selector) {
      actions.push(["focus", selector]);
    },
    async click(selector) {
      actions.push(["click", selector]);
    },
    async $() {
      return null;
    },
    async $eval() {
      return "unused@example.com";
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      MANUAL_VERIFICATION: true,
      HIDE_BROWSER_UNTIL_VERIFICATION: true,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      showBrowserWindowFn: async (pageArg) => {
        actions.push(["show", pageArg === page]);
      },
      hideBrowserWindowFn: async (pageArg) => {
        actions.push(["hide", pageArg === page]);
      },
      handleModernVerificationFn: async () => {
        actions.push(["handleModernVerification"]);
      },
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.deepEqual(
    actions.filter((entry) => ["show", "handleModernVerification", "hide"].includes(entry[0])),
    [["show", true], ["handleModernVerification"], ["hide", true]]
  );
});

test("createAccount directly solves press and hold with mouse input", async () => {
  const actions = [];
  const state = {
    holdStarted: false,
    pleaseWaitPollsRemaining: 2,
    challengeComplete: false,
  };

  const holdHandle = {
    async boundingBox() {
      return { x: 20, y: 30, width: 40, height: 50 };
    },
  };

  const challengeFrame = {
    url() {
      return "about:blank";
    },
    async evaluate() {
      if (state.challengeComplete) {
        return {
          title: "",
          bodyText: "",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      if (state.holdStarted && state.pleaseWaitPollsRemaining > 0) {
        state.pleaseWaitPollsRemaining -= 1;
        if (state.pleaseWaitPollsRemaining === 0) {
          state.challengeComplete = true;
        }
        return {
          title: "human verification challenge",
          bodyText: "please wait",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText: "press and hold the button",
        hasAccessibleChallenge: false,
        hasPressAndHoldButton: true,
      };
    },
    async $(selector) {
      actions.push(["frame.$", selector]);
      if (selector === '[aria-label="Press & Hold Human Challenge"]') {
        return holdHandle;
      }
      return null;
    },
    async $x() {
      return [];
    },
  };

  const page = {
    keyboard: { async press() {} },
    mouse: {
      async move(x, y) {
        actions.push(["page.mouse.move", x, y]);
      },
      async down() {
        actions.push(["page.mouse.down"]);
        state.holdStarted = true;
      },
      async up() {
        actions.push(["page.mouse.up"]);
      },
    },
    async goto(url) {
      actions.push(["goto", url]);
    },
    async waitForSelector(selector) {
      actions.push(["waitForSelector", selector]);
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
        "#mainApp",
      ]);

      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }

      if (selector === "#enforcementFrame") {
        throw new Error("modern flow should not wait for #enforcementFrame");
      }

      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type(selector, value) {
      actions.push(["type", selector, value]);
    },
    async focus(selector) {
      actions.push(["focus", selector]);
    },
    async $eval() {
      return "unused@example.com";
    },
    async evaluate() {
      return state.challengeComplete
        ? { title: "", bodyText: "" }
        : {
            title: "let's prove you're human",
            bodyText: "press and hold the button",
          };
    },
    async click(selector) {
      actions.push(["click", selector]);
    },
    async $() {
      return null;
    },
    frames() {
      return [challengeFrame];
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.deepEqual(
    actions.filter((entry) => entry[0].startsWith("page.mouse")),
    [
      ["page.mouse.move", 40, 55],
      ["page.mouse.down"],
      ["page.mouse.up"],
    ]
  );
});

test("createAccount uses mouse hold only and never falls back to accessible challenge or press again", async () => {
  const actions = [];
  const state = {
    holdStarted: false,
    challengeComplete: false,
  };

  const holdHandle = {
    async boundingBox() {
      return { x: 10, y: 20, width: 30, height: 40 };
    },
  };

  const challengeFrame = {
    url() {
      return "about:blank";
    },
    async evaluate() {
      if (state.challengeComplete) {
        return {
          title: "",
          bodyText: "",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      if (state.holdStarted) {
        state.challengeComplete = true;
      }

      return {
        title: "human verification challenge",
        bodyText: "press and hold the button",
        hasAccessibleChallenge: false,
        hasPressAndHoldButton: true,
      };
    },
    async $(selector) {
      actions.push(["frame.$", selector]);
      if (selector === '[aria-label="Press & Hold Human Challenge"]') {
        return holdHandle;
      }
      return null;
    },
    async $x(selector) {
      actions.push(["frame.$x", selector]);
      return [];
    },
  };

  const page = {
    keyboard: {
      async press(key) {
        actions.push(["page.keyboard.press", key]);
      },
    },
    mouse: {
      async move(x, y) {
        actions.push(["page.mouse.move", x, y]);
      },
      async down() {
        actions.push(["page.mouse.down"]);
        state.holdStarted = true;
      },
      async up() {
        actions.push(["page.mouse.up"]);
      },
    },
    async goto() {},
    async waitForSelector(selector) {
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
        "#mainApp",
      ]);

      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }

      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type() {},
    async focus() {},
    async $eval() {
      return "unused@example.com";
    },
    async evaluate() {
      return state.challengeComplete
        ? { title: "", bodyText: "" }
        : {
            title: "let's prove you're human",
            bodyText: "press and hold the button",
          };
    },
    async click() {},
    async $() {
      return null;
    },
    frames() {
      return [challengeFrame];
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.equal(actions.some((entry) => entry[0] === "page.mouse.down"), true);
  assert.equal(actions.some((entry) => entry[0] === "page.mouse.up"), true);
  assert.equal(
    actions.some(
      (entry) =>
        entry[0] === "frame.$x" &&
        (entry[1].toLowerCase().includes("accessible challenge") ||
          entry[1].toLowerCase().includes("press again"))
    ),
    false
  );
});

test("createAccount waits through the completed please-wait state after mouse hold", async () => {
  const actions = [];
  const state = {
    holdStarted: false,
    completedPendingPolls: 2,
    challengeComplete: false,
  };

  const holdHandle = {
    async boundingBox() {
      return { x: 10, y: 20, width: 30, height: 40 };
    },
  };

  const challengeFrame = {
    url() {
      return "about:blank";
    },
    async evaluate() {
      if (state.challengeComplete) {
        return {
          title: "",
          bodyText: "",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      if (state.completedPendingPolls > 0) {
        if (state.holdStarted) {
          state.completedPendingPolls -= 1;
          if (state.completedPendingPolls === 0) {
            state.challengeComplete = true;
          }
        }
        return {
          title: "human verification challenge",
          bodyText: state.holdStarted
            ? "human challenge completed, please wait"
            : "press and hold the button",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: !state.holdStarted,
        };
      }

      return {
        title: "human verification challenge",
        bodyText: "press and hold the button",
        hasAccessibleChallenge: false,
        hasPressAndHoldButton: true,
      };
    },
    async $(selector) {
      actions.push(["frame.$", selector]);

      if (selector === '[aria-label="Press & Hold Human Challenge"]') {
        return holdHandle;
      }

      return null;
    },
    async $x() {
      return [];
    },
  };

  const page = {
    keyboard: {
      async press(key) {
        actions.push(["page.keyboard.press", key]);
      },
    },
    mouse: {
      async click(x, y) {
        actions.push(["page.mouse.click", x, y]);
      },
      async move(x, y) {
        actions.push(["page.mouse.move", x, y]);
      },
      async down() {
        actions.push(["page.mouse.down"]);
        state.holdStarted = true;
      },
      async up() {
        actions.push(["page.mouse.up"]);
      },
    },
    async goto() {},
    async waitForSelector(selector) {
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
        "#mainApp",
      ]);

      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }

      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type() {},
    async focus() {},
    async $eval() {
      return "unused@example.com";
    },
    async evaluate() {
      return state.challengeComplete
        ? { title: "", bodyText: "" }
        : {
            title: "let's prove you're human",
            bodyText:
              state.completedPendingPolls > 0
                ? "please wait"
                : "verification in progress",
          };
    },
    async click() {},
    async $() {
      return null;
    },
    frames() {
      return [challengeFrame];
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.equal(
    actions.some(
      (entry) =>
        entry[0] === "frame.$" &&
        (entry[1] === '[aria-label="Accessible challenge"]' ||
          entry[1] === '[aria-label="Press again"]')
    ),
    false
  );
});

test("createAccount ignores hidden press-and-hold containers and holds the visible button", async () => {
  const actions = [];
  const state = {
    holdStarted: false,
    challengeComplete: false,
  };
  let lastMove = null;

  const hiddenHoldHandle = {
    async boundingBox() {
      return null;
    },
    async evaluate(fn) {
      return fn({
        getBoundingClientRect() {
          return { left: 0, top: 0, width: 0, height: 0 };
        },
      });
    },
  };

  const visibleHoldHandle = {
    async boundingBox() {
      return { x: 100, y: 120, width: 50, height: 40 };
    },
  };

  const hiddenFrame = {
    url() {
      return "about:blank";
    },
    async evaluate() {
      if (state.challengeComplete) {
        return {
          title: "",
          bodyText: "",
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText:
          "human challenge requires verification. please press and hold the button once",
        hasPressAndHoldButton: true,
      };
    },
    async $(selector) {
      actions.push(["hiddenFrame.$", selector]);
      if (selector === '[aria-label="Press & Hold Human Challenge"]') {
        return hiddenHoldHandle;
      }
      return null;
    },
    async evaluateHandle() {
      return {
        asElement() {
          return null;
        },
        async dispose() {},
      };
    },
    async $x() {
      return [];
    },
  };

  const visibleFrame = {
    url() {
      return "about:blank";
    },
    async evaluate() {
      if (state.challengeComplete) {
        return {
          title: "",
          bodyText: "",
          hasPressAndHoldButton: false,
        };
      }

      if (state.holdStarted) {
        state.challengeComplete = true;
        return {
          title: "human verification challenge",
          bodyText: "please wait",
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText: "press and hold •••",
        hasPressAndHoldButton: false,
      };
    },
    async $(selector) {
      actions.push(["visibleFrame.$", selector]);
      return null;
    },
    async evaluateHandle() {
      return {
        asElement() {
          return visibleHoldHandle;
        },
      };
    },
    async $x() {
      return [];
    },
  };

  const page = {
    keyboard: { async press() {} },
    mouse: {
      async move(x, y) {
        lastMove = { x, y };
        actions.push(["page.mouse.move", x, y]);
      },
      async down() {
        actions.push(["page.mouse.down"]);
        if (lastMove && lastMove.x === 125 && lastMove.y === 140) {
          state.holdStarted = true;
        }
      },
      async up() {
        actions.push(["page.mouse.up"]);
      },
    },
    async goto() {},
    async waitForSelector(selector) {
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
        "#mainApp",
      ]);

      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }

      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type() {},
    async focus() {},
    async $eval() {
      return "unused@example.com";
    },
    async evaluate() {
      return state.challengeComplete
        ? { title: "", bodyText: "" }
        : {
            title: "let's prove you're human",
            bodyText: "press and hold the button",
          };
    },
    async click() {},
    async $() {
      return null;
    },
    frames() {
      return [hiddenFrame, visibleFrame];
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.equal(state.holdStarted, true);
  assert.deepEqual(
    actions.filter((entry) => entry[0] === "page.mouse.move"),
    [["page.mouse.move", 125, 140]]
  );
});

test("createAccount ignores main-page press-and-hold text and targets the challenge subframe button", async () => {
  const actions = [];
  const state = {
    holdStarted: false,
    challengeComplete: false,
  };
  let lastMove = null;

  const mainPageFalseTargetHandle = {
    async boundingBox() {
      return { x: 300, y: 280, width: 200, height: 40 };
    },
  };

  const visibleHoldHandle = {
    async boundingBox() {
      return { x: 100, y: 120, width: 50, height: 40 };
    },
  };

  const mainFrame = {
    url() {
      return "https://signup.live.com/signup";
    },
    async evaluate() {
      return {
        title: "let's prove you're human",
        bodyText:
          "main page wrapper text press and hold the button help and feedback",
        hasPressAndHoldButton: false,
      };
    },
    async $(selector) {
      actions.push(["mainFrame.$", selector]);
      return null;
    },
    async evaluateHandle() {
      return {
        asElement() {
          return mainPageFalseTargetHandle;
        },
      };
    },
    async $x() {
      return [];
    },
  };

  const challengeFrame = {
    url() {
      return "about:blank";
    },
    async evaluate() {
      if (state.challengeComplete) {
        return {
          title: "",
          bodyText: "",
          hasPressAndHoldButton: false,
        };
      }

      if (state.holdStarted) {
        state.challengeComplete = true;
        return {
          title: "human verification challenge",
          bodyText: "please wait",
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText:
          "human challenge requires verification. please press and hold the button until verified",
        hasPressAndHoldButton: true,
      };
    },
    async $(selector) {
      actions.push(["challengeFrame.$", selector]);
      if (selector === '[aria-label="Press & Hold Human Challenge"]') {
        return visibleHoldHandle;
      }
      return null;
    },
    async evaluateHandle() {
      return {
        asElement() {
          return null;
        },
        async dispose() {},
      };
    },
    async $x() {
      return [];
    },
  };

  const page = {
    keyboard: { async press() {} },
    mouse: {
      async move(x, y) {
        lastMove = { x, y };
        actions.push(["page.mouse.move", x, y]);
      },
      async down() {
        actions.push(["page.mouse.down"]);
        if (lastMove && lastMove.x === 125 && lastMove.y === 140) {
          state.holdStarted = true;
        }
      },
      async up() {
        actions.push(["page.mouse.up"]);
      },
    },
    async goto() {},
    async waitForSelector(selector) {
      const allowed = new Set([
        "#floatingLabelInput4",
        'input[type=\"password\"]',
        "#floatingLabelInput24",
        "#firstNameInput",
        "#lastNameInput",
        "#declineButton",
        "#mainApp",
      ]);

      if (selector === "#usernameInput") {
        throw new Error("legacy selector missing");
      }

      if (!allowed.has(selector)) {
        throw new Error(`unexpected selector ${selector}`);
      }
    },
    async type() {},
    async focus() {},
    async $eval() {
      return "unused@example.com";
    },
    async evaluate() {
      return state.challengeComplete
        ? { title: "", bodyText: "" }
        : {
            title: "let's prove you're human",
            bodyText: "press and hold the button",
          };
    },
    async click() {},
    async $() {
      return null;
    },
    frames() {
      return [mainFrame, challengeFrame];
    },
    url() {
      return "https://signup.live.com/signup";
    },
  };

  await createAccount(
    page,
    {
      ADD_RECOVERY_EMAIL: false,
      ACCOUNTS_FILE: "/tmp/accounts.txt",
      NAMES_FILE: "src/Utils/names.txt",
      WORDS_FILE: "src/Utils/words5char.txt",
      MANUAL_VERIFICATION: false,
    },
    {
      logFn: () => {},
      delayFn: async () => {},
      generatePersonalInfoFn: async () => ({
        username: "testuser123",
        randomFirstName: "Mario",
        randomLastName: "Rossi",
        birthDay: "1",
        birthMonth: "1",
        birthYear: "1995",
      }),
      generatePasswordFn: async () => "secret123!",
      writeCredentialsFn: async () => {},
    }
  );

  assert.equal(state.holdStarted, true);
  assert.deepEqual(
    actions.filter((entry) => entry[0] === "page.mouse.move"),
    [["page.mouse.move", 125, 140]]
  );
});
