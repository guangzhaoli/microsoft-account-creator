const fs = require("fs");
const config = require("./config");
const log = require("./Utils/log");
const recMail = require("./Utils/recMail");
const { createBrowserSession } = require("./browser/session");
const { validateRuntimeConfig } = require("./browser/runtime-config");

async function start(deps = {}) {
  const runtimeConfig = deps.config || config;
  const validateConfig = deps.validateRuntimeConfig || validateRuntimeConfig;
  const createSession = deps.createBrowserSession || createBrowserSession;
  const createAccountFn = deps.createAccount || createAccount;
  const clearConsole = deps.clearConsole || console.clear;

  validateConfig(runtimeConfig);
  clearConsole();

  log("Starting...", "green");
  log("Launching browser...", "green");
  const session = createSession(runtimeConfig);
  await session.launch();

  try {
    const page = await session.newPage();
    await createAccountFn(page, runtimeConfig);
  } finally {
    await session.close();
  }
}

async function createAccount(page, runtimeConfig = config) {
  // Going to Outlook register page.
  await page.goto("https://outlook.live.com/owa/?nlp=1&signup=1");
  await page.waitForSelector(SELECTORS.USERNAME_INPUT);

  // Generating Random Personal Info.
  const PersonalInfo = await generatePersonalInfo(runtimeConfig);

  // Username
  await page.type(SELECTORS.USERNAME_INPUT, PersonalInfo.username);
  await page.keyboard.press("Enter");

  // Password
  const password = await generatePassword(runtimeConfig);
  await page.waitForSelector(SELECTORS.PASSWORD_INPUT);
  await page.type(SELECTORS.PASSWORD_INPUT, password);
  await page.keyboard.press("Enter");

  // First Name and Last Name
  await page.waitForSelector(SELECTORS.FIRST_NAME_INPUT);
  await page.type(SELECTORS.FIRST_NAME_INPUT, PersonalInfo.randomFirstName);
  await page.type(SELECTORS.LAST_NAME_INPUT, PersonalInfo.randomLastName);
  await page.keyboard.press("Enter");

  // Birth Date.
  await page.waitForSelector(SELECTORS.BIRTH_DAY_INPUT);
  await delay(1000);
  await page.select(SELECTORS.BIRTH_DAY_INPUT, PersonalInfo.birthDay);
  await page.select(SELECTORS.BIRTH_MONTH_INPUT, PersonalInfo.birthMonth);
  await page.type(SELECTORS.BIRTH_YEAR_INPUT, PersonalInfo.birthYear);
  await page.keyboard.press("Enter");
  const email = await page.$eval(SELECTORS.EMAIL_DISPLAY, el => el.textContent);
  await page.waitForSelector(SELECTORS.FUNCAPTCHA, { timeout: 60000 });
  log("Please solve the captcha", "yellow");
  await page.waitForFunction(
    (selector) => !document.querySelector(selector),
    {},
    SELECTORS.FUNCAPTCHA
  );
  log("Captcha Solved!", "green");

  // Waiting for confirmed account.
  try {
    await page.waitForSelector(SELECTORS.DECLINE_BUTTON, { timeout: 10000 });
    await page.click(SELECTORS.DECLINE_BUTTON);
  } catch (error) {
    log("DECLINE_BUTTON not found within 10 seconds, checking for POST_REDIRECT_FORM...", "yellow");
    const postRedirectFormExists = await page.$(SELECTORS.POST_REDIRECT_FORM);
    if (postRedirectFormExists) {
      log("POST_REDIRECT_FORM found, checking for CLOSE_BUTTON...", "green");
      await page.waitForSelector(SELECTORS.CLOSE_BUTTON);
      log("CLOSE_BUTTON found, clicking...", "green");
      await page.click(SELECTORS.CLOSE_BUTTON);
    } else {
      log("Neither DECLINE_BUTTON nor POST_REDIRECT_FORM found.", "red");
    }
  }
  await page.waitForSelector(SELECTORS.OUTLOOK_PAGE);

  if (runtimeConfig.ADD_RECOVERY_EMAIL) {
    log("Adding Recovery Email...", "yellow");
    await page.goto("https://account.live.com/proofs/Manage");

    // First verify.
    await page.waitForSelector(SELECTORS.RECOVERY_EMAIL_INPUT);
    const recoveryEmail = await recMail.getEmail();
    await page.type(SELECTORS.RECOVERY_EMAIL_INPUT, recoveryEmail.email);
    await page.keyboard.press("Enter");
    await page.waitForSelector(SELECTORS.EMAIL_CODE_INPUT);
    log("Waiting for Email Code... (first verify)", "yellow");
    firstCode = await recMail.getMessage(recoveryEmail);
    log(`Email Code Received! Code: ${firstCode}`, "green");
    await page.type(SELECTORS.EMAIL_CODE_INPUT, firstCode);
    await page.keyboard.press("Enter");
    await delay(5000);
    if (await page.$(SELECTORS.VERIFICATION_ERROR)) {
      log("Verification Error, resending code...", "red");
      await resendCode(page, recoveryEmail);
    }

    try {
      await page.waitForSelector(SELECTORS.INTERRUPT_CONTAINER, { timeout: 10000 });
    } catch (error) {
      log("INTERRUPT_CONTAINER not found within 10 seconds, checking for AFTER_CODE...", "yellow");
      const afterCodeExists = await page.$(SELECTORS.AFTER_CODE);
      if (afterCodeExists) {
        log("Second Verify Needed", "yellow");
        // Second verify.
        await page.click(SELECTORS.AFTER_CODE);
        await page.waitForSelector(SELECTORS.DOUBLE_VERIFY_EMAIL);
        await page.type(SELECTORS.DOUBLE_VERIFY_EMAIL, recoveryEmail.email);
        await page.keyboard.press("Enter");
        await page.waitForSelector(SELECTORS.DOUBLE_VERIFY_CODE);
        log("Waiting for Email Code... (second verify)", "yellow");
        secondCode = await recMail.getMessage(recoveryEmail);
        log(`Email Code Received! Code: ${secondCode}`, "green");
        await page.type(SELECTORS.DOUBLE_VERIFY_CODE, secondCode);
        await page.keyboard.press("Enter");
        await delay(5000);
        if (await page.$(SELECTORS.VERIFICATION_ERROR)) {
          log("Verification Error, resending code...", "red");
          await resendCode(page, recoveryEmail);
        }
        await page.waitForSelector(SELECTORS.INTERRUPT_CONTAINER);
      } else {
        log("Neither INTERRUPT_CONTAINER nor AFTER_CODE found.", "red");
      }
    }
  }

  await writeCredentials(email, password, runtimeConfig);

}

async function resendCode(page, recoveryEmail) {
  await page.click(SELECTORS.RESEND_CODE);
  await page.waitForSelector(SELECTORS.EMAIL_CODE_INPUT);
  log("Waiting for Email Code...", "yellow");
  code = await recMail.getMessage(recoveryEmail);
  log(`Email Code Received! Code: ${firstCode}`, "green");
  await page.type(SELECTORS.EMAIL_CODE_INPUT, firstCode);
  await page.keyboard.press("Enter");
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
  const names = fs.readFileSync(runtimeConfig.NAMES_FILE, "utf8").split("\n");
  const randomFirstName = names[Math.floor(Math.random() * names.length)].trim();
  const randomLastName = names[Math.floor(Math.random() * names.length)].trim();
  const username = randomFirstName + randomLastName + Math.floor(Math.random() * 9999);
  const birthDay = (Math.floor(Math.random() * 28) + 1).toString()
  const birthMonth = (Math.floor(Math.random() * 12) + 1).toString()
  const birthYear = (Math.floor(Math.random() * 10) + 1990).toString()
  return { username, randomFirstName, randomLastName, birthDay, birthMonth, birthYear };
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

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

if (require.main === module) {
  start().catch((error) => {
    log(error.message, "red");
    process.exit(1);
  });
}

module.exports = {
  start,
};
