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

test("createAccount handles accessible challenge before waiting for the captcha frame", async () => {
  const actions = [];
  const state = {
    accessibleClicked: false,
    pleaseWaitPollsRemaining: 1,
    challengeComplete: false,
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

      if (state.accessibleClicked && state.pleaseWaitPollsRemaining > 0) {
        state.pleaseWaitPollsRemaining -= 1;
        return {
          title: "human verification challenge",
          bodyText: "please wait",
          hasAccessibleChallenge: true,
          hasPressAndHoldButton: true,
        };
      }

      if (state.accessibleClicked) {
        return {
          title: "human verification challenge",
          bodyText: "press again",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText:
          "human challenge requires verification. please press the button once, wait for confirmation, and press again when prompted press and hold",
        hasAccessibleChallenge: true,
        hasPressAndHoldButton: true,
      };
    },
    async $x(selector) {
      actions.push(["frame.$x", selector]);

      if (
        selector.toLowerCase().includes("accessible challenge") &&
        !state.accessibleClicked
      ) {
        return [
          {
            async click() {
              actions.push(["handle.click", "accessible"]);
              state.accessibleClicked = true;
            },
          },
        ];
      }

      if (
        selector.toLowerCase().includes("press again") &&
        state.accessibleClicked &&
        state.pleaseWaitPollsRemaining === 0 &&
        !state.challengeComplete
      ) {
        return [
          {
            async click() {
              actions.push(["handle.click", "press again"]);
              state.challengeComplete = true;
            },
          },
        ];
      }

      return [];
    },
  };

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

  const relevantActions = actions.filter(
    (entry) =>
      entry[0] === "handle.click" ||
      (entry[0] === "frame.$x" &&
        (entry[1].toLowerCase().includes("accessible challenge") ||
          entry[1].toLowerCase().includes("press again")))
  );

  assert.equal(
    relevantActions.some(
      (entry) =>
        entry[0] === "frame.$x" &&
        entry[1].toLowerCase().includes("accessible challenge")
    ),
    true
  );
  assert.equal(
    relevantActions.some(
      (entry) =>
        entry[0] === "frame.$x" &&
        entry[1].toLowerCase().includes("press again")
    ),
    true
  );
  assert.deepEqual(
    relevantActions.filter((entry) => entry[0] === "handle.click"),
    [
      ["handle.click", "accessible"],
      ["handle.click", "press again"],
    ]
  );
});

test("createAccount falls back to keyboard activation when challenge click does not advance", async () => {
  const actions = [];
  const state = {
    accessibleActivated: false,
    pressAgainShown: false,
    challengeComplete: false,
  };

  const accessibleHandle = {
    async click() {
      actions.push(["handle.click", "accessible"]);
    },
    async focus() {
      actions.push(["handle.focus", "accessible"]);
    },
    async press(key) {
      actions.push(["handle.press", key]);
      if (key === "Enter") {
        state.accessibleActivated = true;
        state.pressAgainShown = true;
      }
    },
    async hover() {
      actions.push(["handle.hover", "accessible"]);
    },
    async boundingBox() {
      return { x: 10, y: 20, width: 30, height: 40 };
    },
  };

  const pressAgainHandle = {
    async click() {
      actions.push(["handle.click", "press again"]);
      state.challengeComplete = true;
    },
    async focus() {
      actions.push(["handle.focus", "press again"]);
    },
    async press(key) {
      actions.push(["handle.press", `press-again:${key}`]);
    },
    async hover() {
      actions.push(["handle.hover", "press again"]);
    },
    async boundingBox() {
      return { x: 50, y: 60, width: 70, height: 80 };
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

      if (state.pressAgainShown) {
        return {
          title: "human verification challenge",
          bodyText: "press again",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText:
          "human challenge requires verification. please press the button once, wait for confirmation, and press again when prompted press and hold",
        hasAccessibleChallenge: true,
        hasPressAndHoldButton: true,
      };
    },
    async $x(selector) {
      actions.push(["frame.$x", selector]);

      if (
        selector.toLowerCase().includes("accessible challenge") &&
        !state.accessibleActivated
      ) {
        return [accessibleHandle];
      }

      if (
        selector.toLowerCase().includes("press again") &&
        state.pressAgainShown &&
        !state.challengeComplete
      ) {
        return [pressAgainHandle];
      }

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

  assert.equal(
    actions.some(
      (entry) => entry[0] === "handle.press" && entry[1] === "Enter"
    ),
    true
  );
  assert.deepEqual(
    actions.filter((entry) => entry[0] === "handle.click"),
    [
      ["handle.click", "accessible"],
      ["handle.click", "press again"],
    ]
  );
});

test("createAccount waits through the completed please-wait state after press again", async () => {
  const actions = [];
  const state = {
    accessibleActivated: false,
    pressAgainShown: false,
    completedPendingPolls: 2,
    challengeComplete: false,
  };

  const accessibleHandle = {
    async click() {
      actions.push(["handle.click", "accessible"]);
      state.accessibleActivated = true;
      state.pressAgainShown = true;
    },
    async focus() {
      actions.push(["handle.focus", "accessible"]);
    },
    async press(key) {
      actions.push(["handle.press", key]);
    },
    async hover() {
      actions.push(["handle.hover", "accessible"]);
    },
    async boundingBox() {
      return { x: 10, y: 20, width: 30, height: 40 };
    },
  };

  const pressAgainHandle = {
    async click() {
      actions.push(["handle.click", "press again"]);
      state.pressAgainShown = false;
      state.completedPendingPolls = 2;
    },
    async focus() {
      actions.push(["handle.focus", "press again"]);
    },
    async press(key) {
      actions.push(["handle.press", `press-again:${key}`]);
    },
    async hover() {
      actions.push(["handle.hover", "press again"]);
    },
    async boundingBox() {
      return { x: 50, y: 60, width: 70, height: 80 };
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
        state.completedPendingPolls -= 1;
        if (state.completedPendingPolls === 0) {
          state.challengeComplete = true;
        }
        return {
          title: "human verification challenge",
          bodyText: "human challenge completed, please wait",
          hasAccessibleChallenge: true,
          hasPressAndHoldButton: true,
        };
      }

      if (state.pressAgainShown) {
        return {
          title: "human verification challenge",
          bodyText: "press again",
          hasAccessibleChallenge: false,
          hasPressAndHoldButton: false,
        };
      }

      return {
        title: "human verification challenge",
        bodyText: "accessible challenge",
        hasAccessibleChallenge: true,
        hasPressAndHoldButton: false,
      };
    },
    async $(selector) {
      actions.push(["frame.$", selector]);

      if (selector === '[aria-label="Accessible challenge"]' && !state.accessibleActivated) {
        return accessibleHandle;
      }

      if (selector === '[aria-label="Press again"]' && state.pressAgainShown) {
        return pressAgainHandle;
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
      async down(key) {
        actions.push(["page.keyboard.down", key]);
      },
      async up(key) {
        actions.push(["page.keyboard.up", key]);
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
        entry[0] === "page.keyboard.down" || entry[0] === "page.keyboard.up"
    ),
    false
  );
});
