const fs = require("fs");
const config = require("./config");
const log = require("./Utils/log");
const recMail = require("./Utils/recMail");
const {
  ENGLISH_FIRST_NAMES,
  ENGLISH_LAST_NAMES,
} = require("./Utils/english-names");
const { createBrowserSession } = require("./browser/session");
const {
  validateRuntimeConfig,
  isOauthEnabled,
  normalizeProxyMode,
  resolveTaskProxy,
  withResolvedProxy,
  PROXY_MODE_POOL,
} = require("./browser/runtime-config");
const { createProxyPoolManager } = require("./browser/proxy-pool");
const { completeOAuth2 } = require("./oauth2");

const SIGNUP_URL = "https://signup.live.com/signup";
const ACCOUNT_CHECKUP_CANCEL_URL =
  "https://account.microsoft.com/?lang=en-US&wa=wsignin1.0&refd=login.live.com&client_flight=cmmenbvo5zj&status=cancelled&res=acw_landing_page_cancelled";
const MODERN_SELECTORS = {
  EMAIL_INPUT: "#floatingLabelInput4",
  PASSWORD_INPUT: 'input[type="password"]',
  BIRTH_MONTH_DROPDOWN: "#BirthMonthDropdown",
  BIRTH_DAY_DROPDOWN: "#BirthDayDropdown",
  BIRTH_YEAR_INPUT: "#floatingLabelInput24",
  FIRST_NAME_INPUT: "#firstNameInput",
  LAST_NAME_INPUT: "#lastNameInput",
  NEXT_BUTTON: 'button[type="submit"]',
};
const VERIFICATION_TEXT = {
  PLEASE_WAIT: ["please wait"],
  PRESS_AND_HOLD: ["press and hold"],
  PROVE_YOURE_HUMAN: ["let's prove you're human"],
  CHALLENGE_COMPLETED: ["challenge completed", "completed, please wait"],
};

async function start(deps = {}) {
  const runtimeConfig = deps.config || config;
  const validateConfig = deps.validateRuntimeConfig || validateRuntimeConfig;
  const clearConsole = deps.clearConsole || console.clear;
  const logFn = deps.logFn || log;
  const runSingleRegistrationAttemptFn =
    deps.runSingleRegistrationAttemptFn || runSingleRegistrationAttempt;
  const createProxyPoolManagerFn =
    deps.createProxyPoolManager || createProxyPoolManager;
  const resolveTaskProxyFn = deps.resolveTaskProxy || resolveTaskProxy;
  const withResolvedProxyFn = deps.withResolvedProxy || withResolvedProxy;
  const workerCount = runtimeConfig.WORKERS;
  const targetSuccessCount = runtimeConfig.COUNTS;

  validateConfig(runtimeConfig);
  clearConsole();
  logFn("Starting...", "green");

  const proxyMode = normalizeProxyMode(runtimeConfig.PROXY_MODE);
  const proxyPoolManager =
    proxyMode === PROXY_MODE_POOL && runtimeConfig.PROXY_POOL_CONFIG_FILE
      ? await createProxyPoolManagerFn(runtimeConfig, deps)
      : null;

  let successCount = 0;
  let inFlight = 0;
  const activeWorkers = Math.min(workerCount, targetSuccessCount);
  const reserveAttempt = () => {
    if (successCount + inFlight >= targetSuccessCount) {
      return false;
    }

    inFlight += 1;
    return true;
  };

  try {
    await Promise.all(
      Array.from({ length: activeWorkers }, (_, workerIndex) =>
        runWorkerLoop(workerIndex + 1)
      )
    );
  } finally {
    if (proxyPoolManager && typeof proxyPoolManager.close === "function") {
      await proxyPoolManager.close();
    }
  }

  async function runWorkerLoop(workerId) {
    const workerLogFn = createWorkerLogFn({
      logFn,
      workerId,
      workerCount,
    });

    while (reserveAttempt()) {
      try {
        const attemptConfig = await resolveAttemptConfig(runtimeConfig);
        await runSingleRegistrationAttemptFn(attemptConfig, {
          ...deps,
          logFn: workerLogFn,
        });
        successCount += 1;
      } catch (error) {
        workerLogFn(
          `Registration attempt failed: ${error.message}`,
          "red"
        );
      } finally {
        inFlight -= 1;
      }
    }
  }

  async function resolveAttemptConfig(baseConfig) {
    const resolvedProxy =
      proxyPoolManager && typeof proxyPoolManager.pickProxy === "function"
        ? await proxyPoolManager.pickProxy()
        : await resolveTaskProxyFn(baseConfig, deps);
    return withResolvedProxyFn(baseConfig, resolvedProxy);
  }
}

async function runSingleRegistrationAttempt(runtimeConfig = config, deps = {}) {
  const createSession = deps.createBrowserSession || createBrowserSession;
  const createAccountFn = deps.createAccount || createAccount;
  const hideBrowserWindowFn = deps.hideBrowserWindowFn || hideBrowserWindow;
  const logFn = deps.logFn || log;

  logFn("Launching browser...", "green");
  const session = createSession(runtimeConfig);
  await session.launch();
  logFn("Browser launched", "green");

  try {
    const page = await session.newPage();
    logFn("Browser page ready, starting registration flow...", "green");
    if (runtimeConfig.HIDE_BROWSER_UNTIL_VERIFICATION === true) {
      await hideBrowserWindowFn(page);
    }
    await createAccountFn(page, runtimeConfig, { logFn });
  } finally {
    await session.close();
  }
}

function createWorkerLogFn(options = {}) {
  const logFn = options.logFn || log;
  const workerId = options.workerId;
  const workerCount = options.workerCount;

  if (!workerId || !workerCount || workerCount <= 1) {
    return logFn;
  }

  return (message, color) =>
    logFn(`[worker ${workerId}/${workerCount}] ${message}`, color);
}

async function createAccount(page, runtimeConfig = config, deps = {}) {
  const logFn = deps.logFn || log;
  const generatePersonalInfoFn =
    deps.generatePersonalInfoFn || generatePersonalInfo;
  const generatePasswordFn = deps.generatePasswordFn || generatePassword;
  const writeCredentialsFn = deps.writeCredentialsFn || writeCredentials;
  const recMailClient = deps.recMailClient || recMail;
  const delayFn = deps.delayFn || delay;
  const handleLegacyCaptchaFn = deps.handleLegacyCaptchaFn || handleLegacyCaptcha;
  const handleModernVerificationFn =
    deps.handleModernVerificationFn || handleModernVerification;
  const completeOAuth2Fn = deps.completeOAuth2Fn || completeOAuth2;
  const showBrowserWindowFn = deps.showBrowserWindowFn || showBrowserWindow;
  const hideBrowserWindowFn = deps.hideBrowserWindowFn || hideBrowserWindow;
  const pauseBeforeNextPageFn =
    deps.pauseBeforeNextPageFn || pauseBeforeNextPage;
  const hideUntilVerification =
    runtimeConfig.HIDE_BROWSER_UNTIL_VERIFICATION === true;

  // Going to Outlook register page.
  logFn("Opening Outlook signup page...", "green");
  await page.goto(SIGNUP_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  const signupFlow = await detectSignupFlow(page);
  if (!signupFlow) {
    const currentUrl =
      typeof page.url === "function" ? page.url() : "unknown";
    throw new Error(
      `Signup page did not reach username step. Current URL: ${currentUrl}`
    );
  }
  logFn("Signup page ready, generating personal info...", "green");

  // Generating Random Personal Info.
  const PersonalInfo = await generatePersonalInfoFn(runtimeConfig);
  const password = await generatePasswordFn(runtimeConfig);
  let email = "";

  if (signupFlow === "modern") {
    email = `${PersonalInfo.username}@hotmail.com`;

    logFn("Submitting email address...", "green");
    await page.type(MODERN_SELECTORS.EMAIL_INPUT, email);
    await pauseBeforeNextPageFn({ delayFn });
    await page.keyboard.press("Enter");

    await waitForSelectorWithPageDiagnostics(page, MODERN_SELECTORS.PASSWORD_INPUT, {
      timeout: 60000,
      delayFn,
    });
    logFn("Submitting password...", "green");
    await page.type(MODERN_SELECTORS.PASSWORD_INPUT, password);
    await pauseBeforeNextPageFn({ delayFn });
    await page.keyboard.press("Enter");

    await waitForSelectorWithPageDiagnostics(page, MODERN_SELECTORS.BIRTH_YEAR_INPUT, {
      timeout: 60000,
      delayFn,
    });
    logFn("Submitting birth details...", "green");
    await chooseModernDropdownByKeyboard(
      page,
      MODERN_SELECTORS.BIRTH_MONTH_DROPDOWN,
      Math.max(1, Number.parseInt(PersonalInfo.birthMonth, 10) || 1)
    );
    await chooseModernDropdownByKeyboard(
      page,
      MODERN_SELECTORS.BIRTH_DAY_DROPDOWN,
      Math.max(1, Number.parseInt(PersonalInfo.birthDay, 10) || 1)
    );
    await page.type(MODERN_SELECTORS.BIRTH_YEAR_INPUT, PersonalInfo.birthYear);
    await pauseBeforeNextPageFn({ delayFn });
    await page.click(MODERN_SELECTORS.NEXT_BUTTON);

    await waitForSelectorWithPageDiagnostics(page, MODERN_SELECTORS.FIRST_NAME_INPUT, {
      timeout: 60000,
      delayFn,
    });
    logFn("Submitting first and last name...", "green");
    await page.type(
      MODERN_SELECTORS.FIRST_NAME_INPUT,
      PersonalInfo.randomFirstName
    );
    await page.type(
      MODERN_SELECTORS.LAST_NAME_INPUT,
      PersonalInfo.randomLastName
    );
    await pauseBeforeNextPageFn({ delayFn });
    await page.click(MODERN_SELECTORS.NEXT_BUTTON);
  } else {
    // Username
    logFn("Submitting username...", "green");
    await page.type(SELECTORS.USERNAME_INPUT, PersonalInfo.username);
    await pauseBeforeNextPageFn({ delayFn });
    await page.keyboard.press("Enter");

    // Password
    await page.waitForSelector(SELECTORS.PASSWORD_INPUT);
    logFn("Submitting password...", "green");
    await page.type(SELECTORS.PASSWORD_INPUT, password);
    await pauseBeforeNextPageFn({ delayFn });
    await page.keyboard.press("Enter");

    // First Name and Last Name
    await page.waitForSelector(SELECTORS.FIRST_NAME_INPUT);
    logFn("Submitting first and last name...", "green");
    await page.type(SELECTORS.FIRST_NAME_INPUT, PersonalInfo.randomFirstName);
    await page.type(SELECTORS.LAST_NAME_INPUT, PersonalInfo.randomLastName);
    await pauseBeforeNextPageFn({ delayFn });
    await page.keyboard.press("Enter");

    // Birth Date.
    await page.waitForSelector(SELECTORS.BIRTH_DAY_INPUT);
    logFn("Submitting birth date...", "green");
    await delayFn(1000);
    await page.select(SELECTORS.BIRTH_DAY_INPUT, PersonalInfo.birthDay);
    await page.select(SELECTORS.BIRTH_MONTH_INPUT, PersonalInfo.birthMonth);
    await page.type(SELECTORS.BIRTH_YEAR_INPUT, PersonalInfo.birthYear);
    await pauseBeforeNextPageFn({ delayFn });
    await page.keyboard.press("Enter");
    email = await page.$eval(SELECTORS.EMAIL_DISPLAY, el => el.textContent);
  }

  logFn("Birth date submitted, waiting for captcha challenge...", "green");
  if (signupFlow === "modern") {
    if (hideUntilVerification && runtimeConfig.MANUAL_VERIFICATION === true) {
      await showBrowserWindowFn(page);
    }
    await handleModernVerificationFn(page, {
      logFn,
      delayFn,
      manualVerification: runtimeConfig.MANUAL_VERIFICATION === true,
    });
    if (hideUntilVerification && runtimeConfig.MANUAL_VERIFICATION === true) {
      await hideBrowserWindowFn(page);
    }
  } else {
    if (hideUntilVerification) {
      await showBrowserWindowFn(page);
    }
    await handleLegacyCaptchaFn(page, { logFn });
    if (hideUntilVerification) {
      await hideBrowserWindowFn(page);
    }
  }

  await handlePostVerificationPages(page, { logFn, delayFn });
  await handlePostInboxOnboardingPages(page, { logFn, delayFn });

  // Waiting for confirmed account.
  try {
    await waitForSelectorWithTransitionRetry(page, SELECTORS.DECLINE_BUTTON, {
      timeout: 10000,
      delayFn,
    });
    await pauseBeforeNextPageFn({ delayFn });
    await page.click(SELECTORS.DECLINE_BUTTON);
  } catch (error) {
    logFn("DECLINE_BUTTON not found within 10 seconds, checking for POST_REDIRECT_FORM...", "yellow");
    const postRedirectFormExists = await querySelectorWithTransitionRetry(
      page,
      SELECTORS.POST_REDIRECT_FORM,
      { timeout: 10000, delayFn }
    );
    if (postRedirectFormExists) {
      logFn("POST_REDIRECT_FORM found, checking for CLOSE_BUTTON...", "green");
      await waitForSelectorWithTransitionRetry(page, SELECTORS.CLOSE_BUTTON, {
        timeout: 10000,
        delayFn,
      });
      logFn("CLOSE_BUTTON found, clicking...", "green");
      await pauseBeforeNextPageFn({ delayFn });
      await page.click(SELECTORS.CLOSE_BUTTON);
    } else {
      logFn("Neither DECLINE_BUTTON nor POST_REDIRECT_FORM found.", "red");
    }
  }
  logFn("Waiting for post-login landing page...", "green");
  await waitForPostLoginLanding(page, { delayFn, timeout: 60000 });

  if (isOauthEnabled(runtimeConfig)) {
    await completeOAuth2Fn(page, email, password, runtimeConfig, {
      logFn,
      delayFn,
    });
  }

  if (runtimeConfig.ADD_RECOVERY_EMAIL) {
    logFn("Adding Recovery Email...", "yellow");
    await page.goto("https://account.live.com/proofs/Manage");

    // First verify.
    await page.waitForSelector(SELECTORS.RECOVERY_EMAIL_INPUT);
    const recoveryEmail = await recMailClient.getEmail();
    await page.type(SELECTORS.RECOVERY_EMAIL_INPUT, recoveryEmail.email);
    await page.keyboard.press("Enter");
    await page.waitForSelector(SELECTORS.EMAIL_CODE_INPUT);
    logFn("Waiting for Email Code... (first verify)", "yellow");
    firstCode = await recMailClient.getMessage(recoveryEmail);
    logFn(`Email Code Received! Code: ${firstCode}`, "green");
    await page.type(SELECTORS.EMAIL_CODE_INPUT, firstCode);
    await page.keyboard.press("Enter");
    await delayFn(5000);
    if (await page.$(SELECTORS.VERIFICATION_ERROR)) {
      logFn("Verification Error, resending code...", "red");
      await resendCode(page, recoveryEmail, { logFn, recMailClient });
    }

    try {
      await page.waitForSelector(SELECTORS.INTERRUPT_CONTAINER, { timeout: 10000 });
    } catch (error) {
      logFn("INTERRUPT_CONTAINER not found within 10 seconds, checking for AFTER_CODE...", "yellow");
      const afterCodeExists = await page.$(SELECTORS.AFTER_CODE);
      if (afterCodeExists) {
        logFn("Second Verify Needed", "yellow");
        // Second verify.
        await page.click(SELECTORS.AFTER_CODE);
        await page.waitForSelector(SELECTORS.DOUBLE_VERIFY_EMAIL);
        await page.type(SELECTORS.DOUBLE_VERIFY_EMAIL, recoveryEmail.email);
        await page.keyboard.press("Enter");
        await page.waitForSelector(SELECTORS.DOUBLE_VERIFY_CODE);
        logFn("Waiting for Email Code... (second verify)", "yellow");
        secondCode = await recMailClient.getMessage(recoveryEmail);
        logFn(`Email Code Received! Code: ${secondCode}`, "green");
        await page.type(SELECTORS.DOUBLE_VERIFY_CODE, secondCode);
        await page.keyboard.press("Enter");
        await delayFn(5000);
        if (await page.$(SELECTORS.VERIFICATION_ERROR)) {
          logFn("Verification Error, resending code...", "red");
          await resendCode(page, recoveryEmail, { logFn, recMailClient });
        }
        await page.waitForSelector(SELECTORS.INTERRUPT_CONTAINER);
      } else {
        logFn("Neither INTERRUPT_CONTAINER nor AFTER_CODE found.", "red");
      }
    }
  }

  await writeCredentialsFn(email, password, runtimeConfig);

}

async function resendCode(page, recoveryEmail, deps = {}) {
  const logFn = deps.logFn || log;
  const recMailClient = deps.recMailClient || recMail;
  await page.click(SELECTORS.RESEND_CODE);
  await page.waitForSelector(SELECTORS.EMAIL_CODE_INPUT);
  logFn("Waiting for Email Code...", "yellow");
  code = await recMailClient.getMessage(recoveryEmail);
  logFn(`Email Code Received! Code: ${firstCode}`, "green");
  await page.type(SELECTORS.EMAIL_CODE_INPUT, firstCode);
  await page.keyboard.press("Enter");
}

async function detectSignupFlow(page) {
  try {
    await page.waitForSelector(SELECTORS.USERNAME_INPUT, { timeout: 5000 });
    return "legacy";
  } catch (error) {}

  try {
    await page.waitForSelector(MODERN_SELECTORS.EMAIL_INPUT, { timeout: 10000 });
    return "modern";
  } catch (error) {
    return null;
  }
}

async function chooseModernDropdownByKeyboard(page, selector, arrowDownCount) {
  await page.focus(selector);
  await page.keyboard.press("Enter");
  for (let index = 0; index < arrowDownCount; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
}

async function handleLegacyCaptcha(page, deps = {}) {
  const logFn = deps.logFn || log;

  await page.waitForSelector(SELECTORS.FUNCAPTCHA, { timeout: 60000 });
  logFn("Please solve the captcha", "yellow");
  await page.waitForFunction(
    (selector) => !document.querySelector(selector),
    {},
    SELECTORS.FUNCAPTCHA
  );
  logFn("Captcha Solved!", "green");
}

async function handleModernVerification(page, deps = {}) {
  const logFn = deps.logFn || log;
  const delayFn = deps.delayFn || delay;
  const manualVerification = deps.manualVerification === true;

  await waitForModernChallenge(page, { delayFn, timeout: 60000 });
  if (manualVerification) {
    logFn(
      "Please complete the verification manually in the browser...",
      "yellow"
    );
    await waitForManualModernVerificationCompletion(page, {
      delayFn,
      timeout: 300000,
    });
    logFn("Manual verification completed", "green");
    return;
  }

  await solvePressAndHoldChallenge(page, {
    delayFn,
    timeout: 30000,
    logFn,
  });

  logFn("Waiting for verification challenge to complete...", "yellow");
  await waitForModernChallengeToComplete(page, { delayFn, timeout: 60000, logFn });
  logFn("Captcha Solved!", "green");
}

async function handlePostVerificationPages(page, deps = {}) {
  const logFn = deps.logFn || log;
  const delayFn = deps.delayFn || delay;
  const pauseBeforeNextPageFn =
    deps.pauseBeforeNextPageFn || pauseBeforeNextPage;
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    const currentUrl = typeof page.url === "function" ? page.url() : "";
    const mainState = await readCurrentPageState(page);

    if (includesAny(mainState.bodyText, ["stay signed in"])) {
      logFn("Stay signed in prompt detected, choosing No...", "yellow");
      const clicked = await clickPageActionByText(page, ["no"], {
        beforeClickFn: pauseBeforeNextPageFn,
        delayFn,
      });
      if (!clicked) {
        const buttons = await listCurrentPageButtons(page);
        const candidates = await listCurrentPageTextCandidates(page, [
          "yes",
          "no",
          "stay signed in",
        ]);
        throw new Error(
          `Stay signed in page detected. Current URL: ${currentUrl}. ` +
            `Page text: ${(mainState.bodyText || "").slice(0, 400)}. ` +
            `Buttons: ${JSON.stringify(buttons)}. ` +
            `Candidates: ${JSON.stringify(candidates)}`
        );
      }
      await delayFn(2000);
      continue;
    }

    if (
      currentUrl.includes("privacynotice.account.microsoft.com/notice") ||
      includesAny(mainState.bodyText, ["microsoft respects your privacy"])
    ) {
      logFn("Privacy notice detected, accepting notice...", "yellow");
      if (!mainState.bodyText) {
        logFn("Waiting for privacy notice content to render...", "yellow");
        await waitForPageTextOrActions(page, {
          delayFn,
          timeout: 15000,
        });
      }

      const refreshedState = await readCurrentPageState(page);
      if (includesAny(refreshedState.bodyText, ["stay signed in"])) {
        continue;
      }
      const clicked =
        (await clickPageActionByText(page, ["accept"], {
          beforeClickFn: pauseBeforeNextPageFn,
          delayFn,
        })) ||
        (await clickPageActionByText(page, ["ok"], {
          beforeClickFn: pauseBeforeNextPageFn,
          delayFn,
        })) ||
        (await clickPageActionByText(page, ["continue"], {
          beforeClickFn: pauseBeforeNextPageFn,
          delayFn,
        })) ||
        (await clickPageActionByText(page, ["next"], {
          beforeClickFn: pauseBeforeNextPageFn,
          delayFn,
        }));

      if (!clicked) {
        const buttons = await listCurrentPageButtons(page);
        if (!refreshedState.bodyText && buttons.length === 0) {
          await delayFn(2000);
          continue;
        }
        throw new Error(
          `Privacy notice page did not expose a supported button. Current URL: ${currentUrl}. ` +
            `Page text: ${(refreshedState.bodyText || "").slice(0, 400)}. ` +
            `Buttons: ${JSON.stringify(buttons)}`
        );
      }

      await delayFn(2000);
      continue;
    }

    return;
  }

  throw new Error("Timed out while handling post-verification pages");
}

async function handlePostInboxOnboardingPages(page, deps = {}) {
  const logFn = deps.logFn || log;
  const delayFn = deps.delayFn || delay;
  const pauseBeforeNextPageFn =
    deps.pauseBeforeNextPageFn || pauseBeforeNextPage;
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    const outlookRoot = await querySelectorWithTransitionRetry(
      page,
      SELECTORS.OUTLOOK_PAGE,
      { timeout: 1000, delayFn }
    );
    if (outlookRoot) {
      return;
    }

    const currentUrl = typeof page.url === "function" ? page.url() : "";
    const mainState = await readCurrentPageState(page);
    const buttons = await listCurrentPageButtons(page);

    if (currentUrl.includes("account.microsoft.com/account-checkup")) {
      logFn("Account checkup detected, jumping to cancelled landing page...", "yellow");
      await pauseBeforeNextPageFn({ delayFn });
      await page.goto(ACCOUNT_CHECKUP_CANCEL_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await delayFn(2000);
      continue;
    }

    const closeClicked =
      (await clickPageSelector(page, [SELECTORS.CLOSE_BUTTON], {
        beforeClickFn: pauseBeforeNextPageFn,
        delayFn,
      })) ||
      (await clickPageActionByText(page, ["close"], {
        beforeClickFn: pauseBeforeNextPageFn,
        delayFn,
      }));

    if (closeClicked) {
      logFn("Post-login onboarding detected, closing it...", "yellow");
      await delayFn(2000);
      continue;
    }

    if (buttons.length > 0 || mainState.bodyText) {
      return;
    }

    return;
  }

  throw new Error("Timed out while resolving post-login onboarding pages");
}

async function waitForModernChallenge(page, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 60000;

  await waitForAsyncCondition(async () => {
    const states = await listChallengeFrameStates(page);
    return states.some(
      (state) =>
        state.hasPressAndHoldButton ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD)
    );
  }, {
    delayFn,
    timeout,
    description: "modern verification challenge",
    onTimeout: () => buildVerificationStateError(page),
  });
}

async function waitForModernChallengeToComplete(page, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 60000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const states = await listChallengeFrameStates(page);
    const mainState = await readCurrentPageState(page);

    const challengeFramesStillActive = states.some(
      (state) =>
        state.hasPressAndHoldButton ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD) ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PLEASE_WAIT) ||
        includesAny(state.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED)
    );
    const challengePageStillActive =
      includesAny(mainState.title, VERIFICATION_TEXT.PROVE_YOURE_HUMAN) ||
      includesAny(mainState.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD) ||
      includesAny(mainState.bodyText, VERIFICATION_TEXT.PLEASE_WAIT) ||
      includesAny(mainState.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED);
    const completionPending = states.some((state) =>
      includesAny(state.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED)
    );

    if (!challengeFramesStillActive && !challengePageStillActive) {
      return;
    }

    if (completionPending) {
      await delayFn(1000);
      continue;
    }

    await delayFn(500);
  }

  throw await buildVerificationStateError(page);
}

async function waitForManualModernVerificationCompletion(page, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 300000;

  await waitForAsyncCondition(async () => {
    const states = await listChallengeFrameStates(page);
    const mainState = await readCurrentPageState(page);

    const challengeFramesStillActive = states.some(
      (state) =>
        state.hasPressAndHoldButton ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PLEASE_WAIT) ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD) ||
        includesAny(state.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED)
    );
    const challengePageStillActive =
      includesAny(mainState.title, VERIFICATION_TEXT.PROVE_YOURE_HUMAN) ||
      includesAny(mainState.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD) ||
      includesAny(mainState.bodyText, VERIFICATION_TEXT.PLEASE_WAIT) ||
      includesAny(mainState.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED);

    return !challengeFramesStillActive && !challengePageStillActive;
  }, {
    delayFn,
    timeout,
    description: "manual verification completion",
    onTimeout: () => buildVerificationStateError(page),
  });
}

async function solvePressAndHoldChallenge(page, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 10000;
  const logFn = options.logFn || log;
  const holdAction = await findChallengeActionHandleWithinTimeout(
    page,
    VERIFICATION_TEXT.PRESS_AND_HOLD,
    {
      delayFn,
      timeout,
    }
  );

  if (!holdAction) {
    throw await buildVerificationStateError(page);
  }

  if (!page.mouse) {
    throw new Error("Press and hold challenge requires mouse support");
  }

  logFn("Press and hold challenge detected, holding with mouse...", "yellow");
  const point = await getChallengeActionPoint(holdAction);
  await page.mouse.move(point.x, point.y);

  let transitioned = false;
  await page.mouse.down();
  try {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const states = await listChallengeFrameStates(page);
      const mainState = await readCurrentPageState(page);
      const holdStillPresent =
        states.some(
          (state) =>
            state.hasPressAndHoldButton ||
            includesAny(state.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD)
        ) ||
        includesAny(mainState.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD);
      const transitionedToCompletion =
        states.some(
          (state) =>
            includesAny(state.bodyText, VERIFICATION_TEXT.PLEASE_WAIT) ||
            includesAny(state.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED)
        ) ||
        includesAny(mainState.bodyText, VERIFICATION_TEXT.PLEASE_WAIT) ||
        includesAny(mainState.bodyText, VERIFICATION_TEXT.CHALLENGE_COMPLETED);

      if (transitionedToCompletion || !holdStillPresent) {
        transitioned = true;
        break;
      }

      await delayFn(200);
    }
  } finally {
    await page.mouse.up();
  }

  if (!transitioned) {
    throw await buildVerificationStateError(page);
  }

  await delayFn(500);
}

async function getChallengeHandlePoint(handle) {
  if (typeof handle.clickablePoint === "function") {
    return handle.clickablePoint();
  }

  if (typeof handle.boundingBox === "function") {
    const box = await handle.boundingBox();
    if (box) {
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }
  }

  throw new Error("challenge handle has no clickable point");
}

async function getChallengeActionPoint(action) {
  return getChallengeHandlePoint(action.handle);
}

async function getFrameViewportOffset(frame) {
  let x = 0;
  let y = 0;
  let currentFrame = frame;

  while (currentFrame) {
    if (typeof currentFrame.frameElement !== "function") {
      break;
    }

    const frameElement = await currentFrame.frameElement();
    if (!frameElement) {
      break;
    }

    const rect = await frameElement.evaluate((element) => {
      const frameRect = element.getBoundingClientRect();
      return { x: frameRect.left, y: frameRect.top };
    });
    x += rect.x;
    y += rect.y;

    if (typeof frameElement.dispose === "function") {
      await frameElement.dispose();
    }

    currentFrame =
      typeof currentFrame.parentFrame === "function"
        ? currentFrame.parentFrame()
        : null;
  }

  return { x, y };
}

async function findChallengeActionHandle(page, matchers) {
  const currentPageUrl = typeof page.url === "function" ? page.url() : "";

  for (const frame of page.frames()) {
    const frameUrl = typeof frame.url === "function" ? frame.url() : "";
    if (frameUrl === currentPageUrl) {
      continue;
    }

    const handle = await findChallengeActionHandleInFrame(frame, matchers);
    if (handle) {
      return { frame, handle };
    }
  }

  return null;
}

async function findChallengeActionHandleWithinTimeout(
  page,
  matchers,
  options = {}
) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 10000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const action = await findChallengeActionHandle(page, matchers);
    if (action) {
      return action;
    }
    await delayFn(250);
  }

  return null;
}

async function findChallengeActionHandleInFrame(frame, matchers) {
  const exactAriaLabel = getExactChallengeAriaLabel(matchers);

  if (exactAriaLabel && typeof frame.$ === "function") {
    try {
      const handle = await frame.$(`[aria-label="${exactAriaLabel}"]`);
      if (await isUsableChallengeHandle(handle)) {
        return handle;
      }
      await disposeChallengeHandle(handle);
    } catch (error) {}
  }

  if (typeof frame.evaluateHandle === "function") {
    try {
      const jsHandle = await frame.evaluateHandle((needleList) => {
        const normalizedNeedles = needleList.map((needle) =>
          String(needle || "").trim().toLowerCase()
        );
        const candidates = Array.from(
          document.querySelectorAll(
            'button, a, div, span, p, [role="button"], input[type="button"], input[type="submit"]'
          )
        );
        return (
          candidates.find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(candidate);
            if (
              rect.width < 2 ||
              rect.height < 2 ||
              computedStyle.display === "none" ||
              computedStyle.visibility === "hidden" ||
              computedStyle.pointerEvents === "none"
            ) {
              return false;
            }

            const searchableText = [
              candidate.innerText,
              candidate.textContent,
              candidate.getAttribute("aria-label"),
              candidate.getAttribute("title"),
              candidate.getAttribute("value"),
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

            if (!searchableText) {
              return false;
            }

            return normalizedNeedles.some((needle) =>
              searchableText.includes(needle)
            );
          }) || null
        );
      }, matchers);

      if (jsHandle) {
        const handle =
          typeof jsHandle.asElement === "function" ? jsHandle.asElement() : null;
        if (await isUsableChallengeHandle(handle)) {
          return handle;
        }
        await disposeChallengeHandle(handle);
        if (typeof jsHandle.dispose === "function") {
          await jsHandle.dispose();
        }
      }
    } catch (error) {}
  }

  if (typeof frame.$x === "function") {
    try {
      const handles = await frame.$x(buildChallengeActionXPath(matchers));
      for (const handle of handles) {
        if (await isUsableChallengeHandle(handle)) {
          return handle;
        }
        await disposeChallengeHandle(handle);
      }
    } catch (error) {}
  }

  return null;
}

async function isUsableChallengeHandle(handle) {
  if (!handle) {
    return false;
  }

  if (typeof handle.clickablePoint === "function") {
    try {
      const point = await handle.clickablePoint();
      if (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      ) {
        return true;
      }
    } catch (error) {}
  }

  if (typeof handle.boundingBox === "function") {
    try {
      const box = await handle.boundingBox();
      if (
        box &&
        Number.isFinite(box.x) &&
        Number.isFinite(box.y) &&
        box.width >= 2 &&
        box.height >= 2
      ) {
        return true;
      }
    } catch (error) {}
  }

  return false;
}

async function disposeChallengeHandle(handle) {
  if (handle && typeof handle.dispose === "function") {
    try {
      await handle.dispose();
    } catch (error) {}
  }
}

function getExactChallengeAriaLabel(matchers) {
  if (
    matchers.length === 1 &&
    matchers[0].trim().toLowerCase() === "press and hold"
  ) {
    return "Press & Hold Human Challenge";
  }

  return null;
}

async function listChallengeFrameStates(page) {
  const states = [];
  const currentPageUrl = typeof page.url === "function" ? page.url() : "";

  for (const frame of page.frames()) {
    const frameUrl = typeof frame.url === "function" ? frame.url() : "";
    if (frameUrl === currentPageUrl) {
      continue;
    }

    try {
      const state = await frame.evaluate(() => {
        const bodyText = normalizeDocumentText(document.body?.innerText || "");
        return {
          title: normalizeDocumentText(document.title || ""),
          bodyText,
          hasPressAndHoldButton: Boolean(
            document.querySelector('[aria-label="Press & Hold Human Challenge"]')
          ),
        };

        function normalizeDocumentText(value) {
          return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
        }
      });

      states.push({
        frame,
        url: frameUrl,
        ...state,
      });
    } catch (error) {}
  }

  return states;
}

async function readCurrentPageState(page) {
  try {
    return await page.evaluate(() => {
      return {
        title: normalizeDocumentText(document.title || ""),
        bodyText: normalizeDocumentText(document.body?.innerText || ""),
      };

      function normalizeDocumentText(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      }
    });
  } catch (error) {
    return { title: "", bodyText: "" };
  }
}

async function waitForPageTextOrActions(page, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 15000;

  try {
    await waitForAsyncCondition(async () => {
      const mainState = await readCurrentPageState(page);
      const buttons = await listCurrentPageButtons(page);
      return Boolean(mainState.bodyText) || buttons.length > 0;
    }, {
      delayFn,
      timeout,
      description: "page text or actions",
    });
  } catch (error) {}
}

async function listCurrentPageButtons(page) {
  const summaries = [];

  for (const frame of getPageFrames(page)) {
    const summary = await listFrameActions(frame);
    if (summary.length > 0) {
      summaries.push({
        url: typeof frame.url === "function" ? frame.url() : "",
        actions: summary,
      });
    }
  }

  return summaries.slice(0, 10);
}

async function listCurrentPageTextCandidates(page, labels) {
  const summaries = [];

  for (const frame of getPageFrames(page)) {
    const candidates = await listFrameTextCandidates(frame, labels);
    if (candidates.length > 0) {
      summaries.push({
        url: typeof frame.url === "function" ? frame.url() : "",
        candidates,
      });
    }
  }

  return summaries.slice(0, 10);
}

async function listFrameActions(frame) {
  try {
    return await frame.evaluate(() => {
      return Array.from(
        document.querySelectorAll(
          'button, input[type="submit"], input[type="button"], a, [role="button"]'
        )
      )
        .map((element) => ({
          text: normalizeButtonText(
            element.innerText ||
              element.textContent ||
              element.getAttribute("value") ||
              element.getAttribute("aria-label") ||
              ""
          ),
          id: element.id || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          type: element.getAttribute("type") || "",
        }))
        .filter((button) => button.text || button.id || button.ariaLabel)
        .slice(0, 20);

      function normalizeButtonText(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      }
    });
  } catch (error) {
    return [];
  }
}

async function listFrameTextCandidates(frame, labels) {
  try {
    return await frame.evaluate((targetLabels) => {
      const normalizedLabels = targetLabels.map((label) =>
        String(label || "").replace(/\s+/g, " ").trim().toLowerCase()
      );

      return Array.from(
        document.querySelectorAll(
          'button, input, a, div, span, p, label, [role="button"]'
        )
      )
        .map((element) => {
          const text = normalizeText(
            element.innerText ||
              element.textContent ||
              element.getAttribute("value") ||
              element.getAttribute("aria-label") ||
              ""
          );

          return {
            tag: element.tagName,
            id: element.id || "",
            className: element.className || "",
            role: element.getAttribute("role") || "",
            type: element.getAttribute("type") || "",
            ariaLabel: element.getAttribute("aria-label") || "",
            text,
          };
        })
        .filter((candidate) => {
          if (!candidate.text && !candidate.ariaLabel) {
            return false;
          }

          const searchable = normalizeText(
            `${candidate.text} ${candidate.ariaLabel}`
          );
          return normalizedLabels.some((label) => searchable.includes(label));
        })
        .slice(0, 40);

      function normalizeText(value) {
        return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      }
    }, labels);
  } catch (error) {
    return [];
  }
}

async function clickPageActionByText(page, labels, options = {}) {
  for (const frame of getPageFrames(page)) {
    const clicked = await clickFrameActionByText(frame, labels, options);
    if (clicked) {
      return clicked;
    }
  }

  return null;
}

async function clickPageSelector(page, selectors, options = {}) {
  const beforeClickFn = options.beforeClickFn;
  const delayFn = options.delayFn || delay;
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
        if (typeof beforeClickFn === "function") {
          await beforeClickFn({ delayFn });
        }
        await handle.click({ delay: 100 });
        return selector;
      } catch (error) {}
    }
  }

  return null;
}

function getPageFrames(page) {
  if (page && typeof page.frames === "function") {
    return page.frames();
  }

  return [page];
}

async function clickFrameActionByText(frame, labels, options = {}) {
  const beforeClickFn = options.beforeClickFn;
  const delayFn = options.delayFn || delay;
  try {
    if (typeof frame.$$ !== "function") {
      return null;
    }

    const normalizedLabels = labels.map((label) =>
      String(label || "").replace(/\s+/g, " ").trim().toLowerCase()
    );
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

      if (!text || !normalizedLabels.includes(text)) {
        continue;
      }

      if (typeof beforeClickFn === "function") {
        await beforeClickFn({ delayFn });
      }
      await handle.click({ delay: 100 });
      return text;
    }

    return null;
  } catch (error) {
    return null;
  }
}

function buildChallengeActionXPath(matchers) {
  const textPredicates = matchers.flatMap((matcher) => {
    const normalizedMatcher = matcher.trim().toLowerCase();
    const literal = toXPathLiteral(normalizedMatcher);

    return [
      `contains(translate(normalize-space(string(.)), "${XPATH_UPPERCASE}", "${XPATH_LOWERCASE}"), ${literal})`,
      `contains(translate(normalize-space(@aria-label), "${XPATH_UPPERCASE}", "${XPATH_LOWERCASE}"), ${literal})`,
      `contains(translate(normalize-space(@title), "${XPATH_UPPERCASE}", "${XPATH_LOWERCASE}"), ${literal})`,
    ];
  });

  return `//*[self::button or self::a or self::div or self::span or self::p or @role="button"][${textPredicates.join(
    " or "
  )}]`;
}

function toXPathLiteral(value) {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes('"')) {
    return `"${value}"`;
  }

  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(', "\"", ')})`;
}

function includesAny(value, matchers) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return matchers.some((matcher) => normalizedValue.includes(matcher));
}

async function waitForAsyncCondition(checkFn, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 30000;
  const description = options.description || "condition";
  const onTimeout = options.onTimeout;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await checkFn();
    if (result) {
      return result;
    }
    await delayFn(250);
  }

  if (typeof onTimeout === "function") {
    throw await onTimeout();
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function isRecoverablePageTransitionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("detached frame") ||
    message.includes("execution context was destroyed") ||
    message.includes("cannot find context with specified id") ||
    message.includes("node with given id does not belong to the document")
  );
}

function isRetryableSelectorWaitError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    isRecoverablePageTransitionError(error) ||
    (message.includes("waiting for selector") && message.includes("exceeded")) ||
    (message.includes("waiting failed") && message.includes("exceeded"))
  );
}

async function waitForSelectorWithTransitionRetry(page, selector, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 30000;
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await page.waitForSelector(selector, {
        timeout: Math.max(1, Math.min(2000, deadline - Date.now())),
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableSelectorWaitError(error)) {
        throw error;
      }
      await delayFn(250);
    }
  }

  throw lastError || new Error(`Timed out waiting for selector: ${selector}`);
}

async function querySelectorWithTransitionRetry(page, selector, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 10000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      return await page.$(selector);
    } catch (error) {
      if (!isRecoverablePageTransitionError(error)) {
        throw error;
      }
      await delayFn(250);
    }
  }

  return null;
}

async function waitForSelectorWithPageDiagnostics(page, selector, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 30000;

  try {
    return await waitForSelectorWithTransitionRetry(page, selector, {
      delayFn,
      timeout,
    });
  } catch (error) {
    const currentUrl = typeof page.url === "function" ? page.url() : "unknown";
    const mainState = await readCurrentPageState(page);
    const buttons = await listCurrentPageButtons(page);
    throw new Error(
      `Waiting for selector \`${selector}\` failed. Current URL: ${currentUrl}. ` +
        `Page title: ${mainState.title || "unknown"}. ` +
        `Page text: ${(mainState.bodyText || "unknown").slice(0, 400)}. ` +
        `Buttons: ${JSON.stringify(buttons)}. ` +
        `Original error: ${error.message}`
    );
  }
}

async function waitForPostLoginLanding(page, options = {}) {
  const delayFn = options.delayFn || delay;
  const timeout = options.timeout || 60000;
  const currentUrl = typeof page.url === "function" ? page.url() : "";

  if (typeof page.frames !== "function") {
    return;
  }

  if (currentUrl.includes("signup.live.com/signup")) {
    return;
  }

  await waitForAsyncCondition(async () => {
    const outlookRoot = await querySelectorWithTransitionRetry(
      page,
      SELECTORS.OUTLOOK_PAGE,
      { timeout: 1000, delayFn }
    );
    if (outlookRoot) {
      return true;
    }

    const currentUrl = typeof page.url === "function" ? page.url() : "";
    return (
      isAccountCancelledLandingUrl(currentUrl) ||
      isAccountHomeLandingUrl(currentUrl) ||
      currentUrl.includes("account.microsoft.com/account-checkup")
    );
  }, {
    delayFn,
    timeout,
    description: "post-login landing page",
    onTimeout: async () => {
      const currentUrl = typeof page.url === "function" ? page.url() : "unknown";
      const mainState = await readCurrentPageState(page);
      const buttons = await listCurrentPageButtons(page);
      return new Error(
        `Post-login landing page did not load. Current URL: ${currentUrl}. ` +
          `Page text: ${(mainState.bodyText || "").slice(0, 400)}. ` +
          `Buttons: ${JSON.stringify(buttons)}`
      );
    },
  });
}

function isAccountCancelledLandingUrl(url) {
  return (
    typeof url === "string" &&
    url.includes("account.microsoft.com/?") &&
    url.includes("status=cancelled") &&
    url.includes("res=acw_landing_page_cancelled")
  );
}

function isAccountHomeLandingUrl(url) {
  return (
    typeof url === "string" &&
    url.includes("account.microsoft.com/?") &&
    !url.includes("status=cancelled")
  );
}

async function buildVerificationStateError(page) {
  const currentUrl = typeof page.url === "function" ? page.url() : "unknown";
  const mainState = await readCurrentPageState(page);
  const challengeStates = await listChallengeFrameStates(page);
  const frameSummary = challengeStates
    .filter(
      (state) =>
        state.hasPressAndHoldButton ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PRESS_AND_HOLD) ||
        includesAny(state.bodyText, VERIFICATION_TEXT.PLEASE_WAIT)
    )
    .map((state) => ({
      url: state.url,
      title: state.title,
      bodyText: state.bodyText.slice(0, 200),
      hasPressAndHoldButton: state.hasPressAndHoldButton,
    }));

  return new Error(
    `Verification challenge did not reach a known state. Current URL: ${currentUrl}. ` +
      `Page title: ${mainState.title || "unknown"}. ` +
      `Page text: ${(mainState.bodyText || "unknown").slice(0, 200)}. ` +
      `Challenge frames: ${JSON.stringify(frameSummary)}`
  );
}

async function writeCredentials(email, password, runtimeConfig = config) {
  // Writes account's credentials on "accounts.txt".
  const account = email + ":" + password;
  log(account, "green");
  fs.appendFile(runtimeConfig.ACCOUNTS_FILE, `\n${account}`, (err) => {
    if (err) {
      log(err, "red");
    }
  });
}

async function generatePersonalInfo(runtimeConfig = config) {
  const randomFirstName = pickRandomEnglishName(ENGLISH_FIRST_NAMES);
  const randomLastName = pickRandomEnglishName(ENGLISH_LAST_NAMES);
  const username = buildEmailPrefix(randomFirstName, randomLastName);
  const birthDay = (Math.floor(Math.random() * 28) + 1).toString()
  const birthMonth = (Math.floor(Math.random() * 12) + 1).toString()
  const birthYear = (Math.floor(Math.random() * 10) + 1990).toString()
  return { username, randomFirstName, randomLastName, birthDay, birthMonth, birthYear };
}

function pickRandomEnglishName(pool) {
  return String(pool[Math.floor(Math.random() * pool.length)] || "").trim();
}

function buildEmailPrefix(firstName, lastName) {
  const normalizedFirstName = normalizeEmailNamePart(firstName);
  const normalizedLastName = normalizeEmailNamePart(lastName);
  const digitLength = 4 + Math.floor(Math.random() * 4);
  const digitString = buildRandomDigitString(digitLength);
  return `${normalizedFirstName}${normalizedLastName}${digitString}`;
}

function normalizeEmailNamePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function buildRandomDigitString(length) {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += Math.floor(Math.random() * 10).toString();
  }
  return output;
}

async function generatePassword(runtimeConfig = config) {
  const words = fs.readFileSync(runtimeConfig.WORDS_FILE, "utf8").split("\n");
  const firstword = words[Math.floor(Math.random() * words.length)].trim();
  const secondword = words[Math.floor(Math.random() * words.length)].trim();
  return firstword + secondword + Math.floor(Math.random() * 9999) + '!';
}

const SELECTORS = {
  USERNAME_INPUT: '#usernameInput',
  PASSWORD_INPUT: '#Password',
  FIRST_NAME_INPUT: '#firstNameInput',
  LAST_NAME_INPUT: '#lastNameInput',
  BIRTH_DAY_INPUT: '#BirthDay',
  BIRTH_MONTH_INPUT: '#BirthMonth',
  BIRTH_YEAR_INPUT: '#BirthYear',
  EMAIL_DISPLAY: '#userDisplayName',
  DECLINE_BUTTON: '#declineButton',
  OUTLOOK_PAGE: '#mainApp',
  RECOVERY_EMAIL_INPUT: '#EmailAddress',
  EMAIL_CODE_INPUT: '#iOttText',
  AFTER_CODE: '#idDiv_SAOTCS_Proofs_Section',
  DOUBLE_VERIFY_EMAIL: '#idTxtBx_SAOTCS_ProofConfirmation',
  DOUBLE_VERIFY_CODE: '#idTxtBx_SAOTCC_OTC',
  INTERRUPT_CONTAINER: '#interruptContainer',
  VERIFICATION_ERROR: '#iVerificationErr',
  RESEND_CODE: '#iShowSendCode',
  POST_REDIRECT_FORM: 'form[data-testid="post-redirect-form"]',
  CLOSE_BUTTON: '#close-button',
  FUNCAPTCHA: '#enforcementFrame',
};
const XPATH_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const XPATH_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function pauseBeforeNextPage(options = {}) {
  const delayFn = options.delayFn || delay;
  const durationMs = 600 + Math.floor(Math.random() * 401);
  await delayFn(durationMs);
}

async function hideBrowserWindow(page) {
  await setBrowserWindowState(page, "minimized");
}

async function showBrowserWindow(page) {
  await setBrowserWindowState(page, "normal");
  if (typeof page.bringToFront === "function") {
    await page.bringToFront();
  }
}

async function setBrowserWindowState(page, windowState) {
  let client = null;
  if (page && typeof page.createCDPSession === "function") {
    client = await page.createCDPSession();
  } else if (page?.target && typeof page.target === "function") {
    const target = page.target();
    if (target && typeof target.createCDPSession === "function") {
      client = await target.createCDPSession();
    }
  }

  if (!client) {
    throw new Error("Browser window control requires CDP session support");
  }

  try {
    const { windowId } = await client.send("Browser.getWindowForTarget");
    await client.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        windowState,
      },
    });
  } finally {
    if (typeof client.detach === "function") {
      await client.detach();
    }
  }
}

if (require.main === module) {
  start().catch((error) => {
    log(error.message, "red");
    process.exit(1);
  });
}

module.exports = {
  start,
  createAccount,
  waitForPostLoginLanding,
  hideBrowserWindow,
  showBrowserWindow,
};
