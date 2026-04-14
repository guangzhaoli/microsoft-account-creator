const test = require("node:test");
const assert = require("node:assert/strict");

const packageJson = require("../package.json");

const WINDOWS_ONLY_PACKAGES = [
  "puppeteer-with-fingerprints",
  "win-screen-resolution",
];

test("windows-only packages are absent from all dependency sections", () => {
  for (const packageName of WINDOWS_ONLY_PACKAGES) {
    assert.equal(
      packageJson.dependencies?.[packageName],
      undefined,
      `${packageName} must not be a required dependency`
    );
    assert.equal(
      packageJson.optionalDependencies?.[packageName],
      undefined,
      `${packageName} must not be an optional dependency`
    );
  }
});

test("puppeteer remains a direct dependency", () => {
  assert.ok(
    packageJson.dependencies?.puppeteer,
    "puppeteer must remain in dependencies"
  );
  assert.doesNotMatch(
    packageJson.dependencies.puppeteer,
    /^npm:rebrowser-puppeteer@/,
    "puppeteer dependency must not alias rebrowser-puppeteer"
  );
});
