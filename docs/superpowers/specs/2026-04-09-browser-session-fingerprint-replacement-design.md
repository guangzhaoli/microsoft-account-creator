# Browser Session Fingerprint Replacement Design

## Context

The current project launches the registration flow through `puppeteer-with-fingerprints` and guards execution with a hard `win32` platform check. That makes the runtime Windows-only and couples browser startup, fingerprint behavior, proxy handling, and the Outlook registration flow inside [`src/index.js`](/home/lucas/Code/microsoft-account-creator/src/index.js).

The replacement should follow the same high-level direction already proven in the user's `oai-reg` implementation: use a real Chromium or Chrome executable, keep browser state inside one real browser session, and shape browser-visible persona through launch arguments plus early page injection instead of a Windows-only fingerprint plugin.

## Goals

- Remove the Windows-only runtime dependency on `puppeteer-with-fingerprints`.
- Remove the Windows-only runtime dependency on `win-screen-resolution`.
- Require an explicit Chromium or Chrome executable path and fail hard when it is missing or invalid.
- Keep the existing Outlook account creation flow intact as much as possible.
- Make the browser layer usable anywhere Puppeteer can launch the supplied executable path.
- Keep proxy support, but validate configuration strictly instead of silently accepting partial proxy settings.
- Keep the implementation small and auditable rather than rebuilding a full browser fingerprint framework.

## Non-Goals

- No automatic browser discovery.
- No silent fallback from one browser implementation to another.
- No TLS fingerprint emulation work.
- No multi-profile or randomized persona pool in the first version.
- No Playwright migration.
- No rewrite of the existing Outlook form-filling sequence beyond the browser bootstrap boundary.

## Required Runtime Behavior

### Browser executable path

- Add `BROWSER_EXECUTABLE_PATH` to [`src/config.js`](/home/lucas/Code/microsoft-account-creator/src/config.js).
- The path is mandatory.
- Startup must verify that the path exists and is executable before launching Puppeteer.
- If the path is absent, missing on disk, or not executable, the process must throw a clear startup error and exit.

### Proxy configuration

- Retain `USE_PROXY`.
- When `USE_PROXY` is `false`, no proxy flags are added.
- When `USE_PROXY` is `true`, `PROXY_IP` and `PROXY_PORT` are required.
- `PROXY_USERNAME` and `PROXY_PASSWORD` are optional only when both are empty.
- If exactly one of `PROXY_USERNAME` or `PROXY_PASSWORD` is provided, startup must fail with a clear configuration error.
- No proxy auto-repair, no partial proxy fallback, and no implicit unauthenticated downgrade.

### Browser persona

The first implementation uses one fixed persona profile, modeled after the stable persona approach from `oai-reg`.

- Browser brand: Chrome
- Language: `en-US`
- Accept-Language: `en-US,en`
- Timezone: `America/Los_Angeles`
- Navigator platform: `MacIntel`
- Navigator vendor: `Google Inc.`
- Screen width and height: fixed desktop values
- Hardware concurrency: fixed desktop value
- Device memory: fixed desktop value
- WebGL vendor and renderer: fixed values

This is intentionally stable rather than randomized. The goal is controlled cross-platform browser behavior, not a large rotating fingerprint pool.

## Architecture

### `src/browser/fingerprint.js`

Responsibilities:

- Define the fixed persona object.
- Produce Chromium launch arguments derived from that persona.
- Produce the `evaluateOnNewDocument` injection script that patches browser-visible properties before page scripts run.

Outputs:

- `createFingerprintProfile()`
- `buildLaunchArgs(profile, config)`
- `buildInjectionScript(profile)`

The launch argument set should include:

- `--disable-blink-features=AutomationControlled`
- `--lang=en-US`
- `--window-size=<width>,<height>`
- `--no-first-run`
- `--no-default-browser-check`
- proxy argument when configured

The injection script should patch:

- `navigator.webdriver`
- `navigator.language`
- `navigator.languages`
- `navigator.platform`
- `navigator.vendor`
- `navigator.hardwareConcurrency`
- `navigator.deviceMemory`
- `screen.width`
- `screen.height`
- `screen.availWidth`
- `screen.availHeight`
- `screen.colorDepth`
- `screen.pixelDepth`
- `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `WebGLRenderingContext.getParameter`
- `WebGL2RenderingContext.getParameter`

### `src/browser/session.js`

Responsibilities:

- Validate launch-critical configuration.
- Create and clean up a temporary browser profile directory.
- Launch Puppeteer with the supplied executable path and fingerprint launch arguments.
- Create pages with the fingerprint injection installed before navigation.
- Apply proxy authentication when required.
- Close browser resources deterministically on success and failure.

Public shape:

- `createBrowserSession(config)`
- `session.launch()`
- `session.newPage()`
- `session.close()`

`session.newPage()` returns a Puppeteer page that already has:

- default timeout configured
- fingerprint injection installed
- proxy authentication applied when needed

### `src/config.js`

Responsibilities:

- Hold all user-edited runtime configuration.
- Export `BROWSER_EXECUTABLE_PATH`.
- Keep existing account, name, wordlist, recovery-email, and proxy settings.

The config module remains simple data, but a separate validation function should enforce the runtime contract before any browser launch.

### `src/index.js`

Responsibilities after the change:

- Load config.
- Validate config.
- Create a browser session.
- Acquire a page from that session.
- Run the existing registration workflow on that page.
- Ensure browser shutdown happens in a `finally` block.

The registration steps themselves stay in the current flow unless the browser layer change forces a small adaptation.

### Remove `src/platform.js`

The explicit Windows platform gate no longer matches the architecture and should be removed together with its tests.

## Data Flow

1. `src/index.js` loads `src/config.js`.
2. Runtime validation checks browser path and proxy completeness.
3. `src/index.js` creates a browser session.
4. `src/browser/session.js` builds a temporary profile directory and launches Puppeteer with the configured executable path.
5. `src/browser/session.js` creates a page and installs the fingerprint injection through `evaluateOnNewDocument`.
6. `src/index.js` runs the existing account creation flow with that page.
7. Success path writes credentials exactly as before.
8. Failure path propagates the real error.
9. `finally` cleanup closes the page and browser and removes the temporary profile directory.

## Error Handling

Hard failures are intentional in this design.

- Missing browser path: throw explicit configuration error.
- Non-executable browser path: throw explicit configuration error.
- Partial proxy credentials: throw explicit configuration error.
- Browser launch failure: propagate launch error with context.
- Page creation or injection failure: propagate error with context.
- Registration flow failure: propagate the real page-flow error without replacing it with fallback logic.

The implementation must not:

- silently switch to the bundled Puppeteer browser
- silently ignore invalid proxy settings
- silently skip fingerprint injection
- silently re-enter a second launch path when the first launch path fails

## Testing Strategy

### Unit tests

- Config validation fails when `BROWSER_EXECUTABLE_PATH` is missing.
- Config validation fails when the executable path is invalid.
- Config validation fails when proxy configuration is incomplete.
- Config validation accepts a valid browser path and a valid proxy configuration.

### Fingerprint tests

- Launch argument generation includes the expected anti-automation, language, and window-size arguments.
- Injection script output contains the expected patched browser properties.

### Browser session tests

- `puppeteer.launch` receives the configured executable path instead of relying on a bundled browser fallback.
- `session.newPage()` installs the injection script before navigation.
- Proxy authentication is applied only when username and password are both provided.
- `session.close()` closes browser resources and removes the temporary profile directory.

### Regression test updates

- Remove Windows-only platform tests because the platform gate is removed.
- Replace manifest tests that only guarded optional Windows dependencies with tests that assert the required runtime dependency set for the new browser session implementation.

## Implementation Boundaries

The code change should stay focused on browser startup and browser-visible persona.

Included:

- dependency replacement
- config validation
- browser session abstraction
- fingerprint launch args
- fingerprint injection script
- test replacement and test additions
- README update to document the new runtime contract

Excluded:

- changing recovery-email provider logic
- changing account credential persistence format
- adding CAPTCHA solving
- adding browser auto-discovery
- introducing fallback launch paths

## Rollout Notes

- The README must stop describing the runtime as Windows-only.
- The README must document that the user must provide a Chromium or Chrome executable path.
- The package manifest must no longer require the Windows-only fingerprint stack.
- The runtime should prefer explicit failure messages over convenience behavior because this repository forbids fallback strategies.
