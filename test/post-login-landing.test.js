const test = require("node:test");
const assert = require("node:assert/strict");

const { waitForPostLoginLanding } = require("../src/index");

test("waitForPostLoginLanding accepts account-checkup as a valid post-login state", async () => {
  const page = {
    url() {
      return "https://account.microsoft.com/account-checkup?uaid=test";
    },
    frames() {
      return [this];
    },
    async $(selector) {
      if (selector === "#mainApp") {
        return null;
      }
      return null;
    },
    async evaluate() {
      return {
        title: "Account checkup",
        bodyText: "protect your account",
      };
    },
  };

  await assert.doesNotReject(() =>
    waitForPostLoginLanding(page, {
      delayFn: async () => {},
      timeout: 10,
    })
  );
});

test("waitForPostLoginLanding accepts the signed-in Microsoft account home page as a valid post-login state", async () => {
  const page = {
    url() {
      return "https://account.microsoft.com/?lang=en-US&wa=wsignin1.0&refd=login.live.com";
    },
    frames() {
      return [this];
    },
    async $(selector) {
      if (selector === "#mainApp") {
        return null;
      }
      return null;
    },
    async evaluate() {
      return {
        title: "Microsoft account",
        bodyText: "never lose access to your microsoft account add a recovery email",
      };
    },
  };

  await assert.doesNotReject(() =>
    waitForPostLoginLanding(page, {
      delayFn: async () => {},
      timeout: 10,
    })
  );
});
