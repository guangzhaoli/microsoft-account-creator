const { EventEmitter } = require("events");

const DEFAULT_TIMEOUT = 30000;
const POLL_INTERVAL_MS = 100;
const KEY_DEFINITIONS = {
  Enter: {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    text: "\r",
  },
  Space: {
    key: " ",
    code: "Space",
    keyCode: 32,
    text: " ",
  },
  ArrowDown: {
    key: "ArrowDown",
    code: "ArrowDown",
    keyCode: 40,
  },
  Tab: {
    key: "Tab",
    code: "Tab",
    keyCode: 9,
  },
};

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

function withTimeout(promise, timeout, message) {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    return promise;
  }

  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, timeout);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function serializeArgument(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function buildEvaluateExpression(pageFunction, args) {
  if (typeof pageFunction === "function") {
    return `(${pageFunction.toString()}).apply(null, ${serializeArgument(args)})`;
  }

  if (typeof pageFunction === "string") {
    return pageFunction;
  }

  throw new Error("Unsupported evaluate payload");
}

function buildCallFunctionDeclaration(pageFunction) {
  if (typeof pageFunction !== "function") {
    throw new Error("ElementHandle.evaluate requires a function");
  }

  return `function(...__args) {
    return (${pageFunction.toString()}).apply(null, [this, ...__args]);
  }`;
}

function normalizeRemoteValue(result) {
  if (!result) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(result, "value")) {
    return result.value;
  }

  if (result.type === "undefined") {
    return undefined;
  }

  if (result.subtype === "null") {
    return null;
  }

  return result;
}

class CdpRemoteHandle {
  constructor(frame, remoteObject) {
    this.frame = frame;
    this.page = frame.page;
    this.client = frame.client;
    this.remoteObject = remoteObject;
  }

  asElement() {
    if (this.remoteObject?.subtype === "node") {
      return this;
    }
    return null;
  }

  async dispose() {
    if (!this.remoteObject?.objectId) {
      return;
    }

    try {
      await this.client.Runtime.releaseObject({
        objectId: this.remoteObject.objectId,
      });
    } catch (error) {}
  }

  async evaluate(pageFunction, ...args) {
    if (!this.remoteObject?.objectId) {
      throw new Error("Cannot evaluate on a disposed handle");
    }

    const result = await this.client.Runtime.callFunctionOn({
      objectId: this.remoteObject.objectId,
      functionDeclaration: buildCallFunctionDeclaration(pageFunction),
      arguments: args.map((arg) => ({ value: arg })),
      returnByValue: true,
      awaitPromise: true,
    });
    return normalizeRemoteValue(result.result);
  }

  async focus() {
    if (!this.remoteObject?.objectId) {
      throw new Error("Cannot focus a disposed handle");
    }

    await this.client.Runtime.callFunctionOn({
      objectId: this.remoteObject.objectId,
      functionDeclaration: `function() {
        if (this && typeof this.scrollIntoView === "function") {
          this.scrollIntoView({ block: "center", inline: "center" });
        }
        if (this && typeof this.focus === "function") {
          this.focus();
        }
      }`,
      awaitPromise: true,
    });
  }

  async hover() {
    const point = await this.clickablePoint();
    await this.page.mouse.move(point.x, point.y);
  }

  async press(key) {
    await this.focus();
    await this.page.keyboard.press(key);
  }

  async click(options = {}) {
    try {
      const point = await this.clickablePoint();
      await this.page.mouse.click(point.x, point.y, options);
      return;
    } catch (error) {}

    if (!this.remoteObject?.objectId) {
      throw new Error("Cannot click a disposed handle");
    }

    await this.client.Runtime.callFunctionOn({
      objectId: this.remoteObject.objectId,
      functionDeclaration: `function() {
        if (this && typeof this.click === "function") {
          this.click();
        }
      }`,
      awaitPromise: true,
    });
  }

  async type(value, options = {}) {
    await this.focus();
    const text = String(value ?? "");
    const delayMs = Math.max(0, Number(options.delay) || 0);

    for (const character of text) {
      await this.page._insertText(character);
      if (delayMs > 0) {
        await delay(delayMs);
      }
    }
  }

  async boundingBox() {
    const rect = await this.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    });
    if (!rect) {
      return null;
    }

    const offset = await this.frame.getViewportOffset();
    return {
      x: offset.x + rect.x,
      y: offset.y + rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  async clickablePoint() {
    const box = await this.boundingBox();
    if (!box) {
      throw new Error("Element has no bounding box");
    }

    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  }
}

class CdpFrame {
  constructor(page, frameId, parentFrameId = null) {
    this.page = page;
    this.client = page.client;
    this.id = frameId;
    this.parentFrameId = parentFrameId;
    this.currentUrl = "";
  }

  update(framePayload = {}) {
    this.currentUrl = String(framePayload.url || this.currentUrl || "");
    this.parentFrameId =
      framePayload.parentId === undefined
        ? this.parentFrameId
        : framePayload.parentId;
  }

  url() {
    return this.currentUrl;
  }

  parentFrame() {
    return this.parentFrameId ? this.page.getFrame(this.parentFrameId) : null;
  }

  async frameElement() {
    if (!this.parentFrameId) {
      return null;
    }

    const parentFrame = this.parentFrame();
    if (!parentFrame) {
      return null;
    }

    const parentContextId = await parentFrame.getContextId();
    const owner = await this.client.DOM.getFrameOwner({ frameId: this.id });
    const resolved = await this.client.DOM.resolveNode({
      backendNodeId: owner.backendNodeId,
      executionContextId: parentContextId,
    });
    return new CdpRemoteHandle(parentFrame, resolved.object);
  }

  async getViewportOffset() {
    const parentFrame = this.parentFrame();
    if (!parentFrame) {
      return { x: 0, y: 0 };
    }

    const frameElement = await this.frameElement();
    if (!frameElement) {
      return { x: 0, y: 0 };
    }

    try {
      const rect = await frameElement.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.left, y: bounds.top };
      });
      const parentOffset = await parentFrame.getViewportOffset();
      return {
        x: parentOffset.x + rect.x,
        y: parentOffset.y + rect.y,
      };
    } finally {
      await frameElement.dispose();
    }
  }

  async getContextId(timeout = this.page.defaultTimeout) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const contextId = this.page.getFrameContextId(this.id);
      if (contextId) {
        return contextId;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new Error(`Execution context not ready for frame ${this.id}`);
  }

  async evaluate(pageFunction, ...args) {
    const contextId = await this.getContextId();
    const response = await this.client.Runtime.evaluate({
      expression: buildEvaluateExpression(pageFunction, args),
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    return normalizeRemoteValue(response.result);
  }

  async evaluateHandle(pageFunction, ...args) {
    const contextId = await this.getContextId();
    const response = await this.client.Runtime.evaluate({
      expression: buildEvaluateExpression(pageFunction, args),
      contextId,
      returnByValue: false,
      awaitPromise: true,
    });
    if (!response?.result || response.result.subtype === "null") {
      return null;
    }
    return new CdpRemoteHandle(this, response.result);
  }

  async $(selector) {
    return this.evaluateHandle((targetSelector) => {
      return document.querySelector(targetSelector);
    }, selector);
  }

  async $$(selector) {
    const contextId = await this.getContextId();
    const response = await this.client.Runtime.evaluate({
      expression: `(function() {
        return Array.from(document.querySelectorAll(${serializeArgument(
          selector
        )}));
      })()`,
      contextId,
      returnByValue: false,
      awaitPromise: true,
    });
    return this.page.materializeHandleArray(this, response.result);
  }

  async $x(xpath) {
    const contextId = await this.getContextId();
    const response = await this.client.Runtime.evaluate({
      expression: `(function() {
        const snapshot = document.evaluate(
          ${serializeArgument(xpath)},
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        const results = [];
        for (let index = 0; index < snapshot.snapshotLength; index += 1) {
          results.push(snapshot.snapshotItem(index));
        }
        return results;
      })()`,
      contextId,
      returnByValue: false,
      awaitPromise: true,
    });
    return this.page.materializeHandleArray(this, response.result);
  }

  async waitForSelector(selector, options = {}) {
    const timeout =
      Number.isFinite(options.timeout) && options.timeout >= 0
        ? options.timeout
        : this.page.defaultTimeout;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const handle = await this.$(selector);
      if (handle && handle.asElement()) {
        return handle;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new Error(`Waiting for selector \`${selector}\` exceeded ${timeout}ms`);
  }

  async type(selector, value, options = {}) {
    const handle = await this.waitForSelector(selector, options);
    try {
      await handle.type(value, options);
    } finally {
      await handle.dispose();
    }
  }
}

class CdpKeyboard {
  constructor(page) {
    this.page = page;
  }

  async press(key) {
    await this.down(key);
    await this.up(key);
  }

  async down(key) {
    await this.page._dispatchKeyEvent("keyDown", key);
  }

  async up(key) {
    await this.page._dispatchKeyEvent("keyUp", key);
  }
}

class CdpMouse {
  constructor(page) {
    this.page = page;
    this.x = 0;
    this.y = 0;
  }

  async move(x, y) {
    this.x = x;
    this.y = y;
    await this.page.client.Input.dispatchMouseEvent({
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
    });
  }

  async down(button = "left") {
    await this.page.client.Input.dispatchMouseEvent({
      type: "mousePressed",
      x: this.x,
      y: this.y,
      button,
      buttons: 1,
      clickCount: 1,
    });
  }

  async up(button = "left") {
    await this.page.client.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x: this.x,
      y: this.y,
      button,
      buttons: 0,
      clickCount: 1,
    });
  }

  async click(x, y, options = {}) {
    await this.move(x, y);
    await this.down(options.button || "left");
    const delayMs = Math.max(0, Number(options.delay) || 0);
    if (delayMs > 0) {
      await delay(delayMs);
    }
    await this.up(options.button || "left");
  }
}

class CdpPage extends EventEmitter {
  constructor(client, options = {}) {
    super();
    this.client = client;
    this.browserClient = options.browserClient || null;
    this.targetId = options.targetId || "";
    this.injectionScript = options.injectionScript || "";
    this.defaultTimeout = DEFAULT_TIMEOUT;
    this.frameMap = new Map();
    this.frameContextMap = new Map();
    this.mainFrameId = "";
    this.keyboard = new CdpKeyboard(this);
    this.mouse = new CdpMouse(this);
    this.authState = {
      enabled: false,
      credentials: null,
    };
  }

  async initialize() {
    const { Page, Runtime, Network, DOM } = this.client;

    Page.frameNavigated((params) => {
      this._registerFrame(params.frame);
      const frame = this.getFrame(params.frame.id);
      if (frame) {
        this.emit("framenavigated", frame);
      }
    });
    Page.frameAttached((params) => {
      this._registerFrame({
        id: params.frameId,
        parentId: params.parentFrameId,
        url: "",
      });
    });
    Page.frameDetached((params) => {
      this._removeFrame(params.frameId);
    });
    Runtime.executionContextCreated((params) => {
      const auxData = params.context?.auxData || {};
      if (auxData.isDefault && auxData.frameId) {
        this.frameContextMap.set(auxData.frameId, params.context.id);
      }
    });
    Runtime.executionContextDestroyed((params) => {
      for (const [frameId, contextId] of this.frameContextMap.entries()) {
        if (contextId === params.executionContextId) {
          this.frameContextMap.delete(frameId);
        }
      }
    });
    Runtime.executionContextsCleared(() => {
      this.frameContextMap.clear();
    });
    Network.requestWillBeSent((params) => {
      this.emit("request", {
        url() {
          return params.request?.url || "";
        },
      });
    });
    Network.responseReceived((params) => {
      this.emit("response", {
        url() {
          return params.response?.url || "";
        },
      });
    });

    await Page.enable();
    await Runtime.enable();
    await DOM.enable();
    await Network.enable();
    await Page.setLifecycleEventsEnabled({ enabled: true });

    if (this.injectionScript) {
      await Page.addScriptToEvaluateOnNewDocument({
        source: this.injectionScript,
      });
    }

    const frameTree = await Page.getFrameTree();
    this._registerFrameTree(frameTree.frameTree);
  }

  _registerFrameTree(frameTree) {
    if (!frameTree) {
      return;
    }

    this._registerFrame(frameTree.frame);
    for (const child of frameTree.childFrames || []) {
      this._registerFrameTree(child);
    }
  }

  _registerFrame(framePayload = {}) {
    if (!framePayload?.id) {
      return;
    }

    let frame = this.frameMap.get(framePayload.id);
    if (!frame) {
      frame = new CdpFrame(this, framePayload.id, framePayload.parentId || null);
      this.frameMap.set(framePayload.id, frame);
    }
    frame.update(framePayload);

    if (!framePayload.parentId) {
      this.mainFrameId = framePayload.id;
    }
  }

  _removeFrame(frameId) {
    this.frameMap.delete(frameId);
    this.frameContextMap.delete(frameId);
  }

  getFrame(frameId) {
    return this.frameMap.get(frameId) || null;
  }

  getFrameContextId(frameId) {
    return this.frameContextMap.get(frameId) || null;
  }

  mainFrame() {
    return this.getFrame(this.mainFrameId);
  }

  frames() {
    if (!this.mainFrameId) {
      return Array.from(this.frameMap.values());
    }

    const ordered = [];
    const visit = (frameId) => {
      const frame = this.getFrame(frameId);
      if (!frame) {
        return;
      }
      ordered.push(frame);
      for (const candidate of this.frameMap.values()) {
        if (candidate.parentFrameId === frameId) {
          visit(candidate.id);
        }
      }
    };
    visit(this.mainFrameId);
    return ordered;
  }

  setDefaultTimeout(timeout) {
    this.defaultTimeout = timeout;
  }

  url() {
    return this.mainFrame()?.url() || "";
  }

  async title() {
    return this.evaluate(() => document.title || "");
  }

  async goto(url, options = {}) {
    const waitUntil =
      options.waitUntil === "domcontentloaded" ? "domcontentloaded" : "load";
    const timeout =
      Number.isFinite(options.timeout) && options.timeout >= 0
        ? options.timeout
        : this.defaultTimeout;
    const waitPromise =
      waitUntil === "domcontentloaded"
        ? this.client.Page.domContentEventFired()
        : this.client.Page.loadEventFired();

    const navigateResult = await this.client.Page.navigate({ url });
    if (
      navigateResult?.errorText &&
      !String(navigateResult.errorText).includes("ERR_ABORTED")
    ) {
      throw new Error(
        `Navigation to ${url} failed: ${navigateResult.errorText}`
      );
    }

    await withTimeout(
      waitPromise,
      timeout,
      `Navigation to ${url} timed out after ${timeout}ms`
    );
  }

  async waitForSelector(selector, options = {}) {
    const frame = this.mainFrame();
    if (!frame) {
      throw new Error("Main frame is not available");
    }
    return frame.waitForSelector(selector, options);
  }

  async $(selector) {
    const frame = this.mainFrame();
    return frame ? frame.$(selector) : null;
  }

  async $$eval(selector, pageFunction, ...args) {
    const handles = await this.$$(selector);
    try {
      const values = [];
      for (const handle of handles) {
        values.push(await handle.evaluate(pageFunction, ...args));
      }
      return values;
    } finally {
      await Promise.all(handles.map((handle) => handle.dispose()));
    }
  }

  async $$(selector) {
    const frame = this.mainFrame();
    return frame ? frame.$$(selector) : [];
  }

  async $eval(selector, pageFunction, ...args) {
    const handle = await this.waitForSelector(selector, {
      timeout: this.defaultTimeout,
    });
    try {
      return await handle.evaluate(pageFunction, ...args);
    } finally {
      await handle.dispose();
    }
  }

  async evaluate(pageFunction, ...args) {
    const frame = this.mainFrame();
    if (!frame) {
      throw new Error("Main frame is not available");
    }
    return frame.evaluate(pageFunction, ...args);
  }

  async type(selector, value, options = {}) {
    const frame = this.mainFrame();
    if (!frame) {
      throw new Error("Main frame is not available");
    }
    return frame.type(selector, value, options);
  }

  async focus(selector) {
    const handle = await this.waitForSelector(selector, {
      timeout: this.defaultTimeout,
    });
    try {
      await handle.focus();
    } finally {
      await handle.dispose();
    }
  }

  async click(selector, options = {}) {
    const handle = await this.waitForSelector(selector, {
      timeout: this.defaultTimeout,
    });
    try {
      await handle.click(options);
    } finally {
      await handle.dispose();
    }
  }

  async select(selector, value) {
    const handle = await this.waitForSelector(selector, {
      timeout: this.defaultTimeout,
    });
    try {
      return await handle.evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return element.value;
      }, value);
    } finally {
      await handle.dispose();
    }
  }

  async waitForFunction(pageFunction, options = {}, ...args) {
    const timeout =
      Number.isFinite(options.timeout) && options.timeout >= 0
        ? options.timeout
        : this.defaultTimeout;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const result = await this.evaluate(pageFunction, ...args);
      if (result) {
        return result;
      }
      await delay(POLL_INTERVAL_MS);
    }

    throw new Error("waitForFunction exceeded timeout");
  }

  async bringToFront() {
    await this.client.Page.bringToFront();
  }

  async authenticate(credentials) {
    this.authState.credentials = credentials || null;
    if (!credentials) {
      if (this.authState.enabled) {
        await this.client.Fetch.disable();
        this.authState.enabled = false;
      }
      return;
    }

    if (this.authState.enabled) {
      return;
    }

    this.client.Fetch.requestPaused((params) => {
      this.client.Fetch.continueRequest({
        requestId: params.requestId,
      }).catch(() => {});
    });
    this.client.Fetch.authRequired((params) => {
      this.client.Fetch.continueWithAuth({
        requestId: params.requestId,
        authChallengeResponse: {
          response: "ProvideCredentials",
          username: credentials.username,
          password: credentials.password,
        },
      }).catch(() => {});
    });
    await this.client.Fetch.enable({
      handleAuthRequests: true,
      patterns: [{ urlPattern: "*" }],
    });
    this.authState.enabled = true;
  }

  target() {
    return {
      createCDPSession: async () => this.createCDPSession(),
    };
  }

  async createCDPSession() {
    const client = this.browserClient || this.client;
    return {
      send(method, params) {
        return client.send(method, params);
      },
      async detach() {},
    };
  }

  async close() {
    try {
      await this.client.close();
    } catch (error) {}
  }

  async materializeHandleArray(frame, arrayRemoteObject) {
    if (!arrayRemoteObject?.objectId) {
      return [];
    }

    try {
      const properties = await this.client.Runtime.getProperties({
        objectId: arrayRemoteObject.objectId,
        ownProperties: true,
      });
      return properties.result
        .filter(
          (entry) =>
            entry.enumerable &&
            /^\d+$/.test(entry.name) &&
            entry.value?.objectId
        )
        .map((entry) => new CdpRemoteHandle(frame, entry.value));
    } finally {
      try {
        await this.client.Runtime.releaseObject({
          objectId: arrayRemoteObject.objectId,
        });
      } catch (error) {}
    }
  }

  async _dispatchKeyEvent(type, key) {
    const definition = KEY_DEFINITIONS[key] || {
      key,
      code: key,
      keyCode:
        typeof key === "string" && key.length === 1
          ? key.toUpperCase().charCodeAt(0)
          : 0,
      text: typeof key === "string" && key.length === 1 ? key : undefined,
    };

    await this.client.Input.dispatchKeyEvent({
      type,
      key: definition.key,
      code: definition.code,
      text: type === "keyDown" ? definition.text : undefined,
      unmodifiedText: type === "keyDown" ? definition.text : undefined,
      windowsVirtualKeyCode: definition.keyCode,
      nativeVirtualKeyCode: definition.keyCode,
    });
  }

  async _insertText(text) {
    await this.client.Input.insertText({ text });
  }
}

async function createPageAdapter(options = {}) {
  const cdp = options.cdp;
  const browserClient = options.browserClient;
  const port = options.port;
  const injectionScript = options.injectionScript || "";

  let targetId = options.targetId;
  if (!targetId) {
    if (!browserClient) {
      throw new Error("browserClient is required to create a CDP page target");
    }
    const created = await browserClient.Target.createTarget({
      url: "about:blank",
    });
    targetId = created.targetId;
  }

  const client = await cdp({
    port,
    target: targetId,
  });
  const page = new CdpPage(client, {
    browserClient,
    targetId,
    injectionScript,
  });
  await page.initialize();
  return page;
}

module.exports = {
  createPageAdapter,
};
