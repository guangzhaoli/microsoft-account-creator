const fs = require("fs");

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

function isProxyEnabled(config) {
  return config?.USE_PROXY === true || config?.USE_PROXY === "true";
}

function validateRuntimeConfig(config, deps = {}) {
  if (isBlank(config?.BROWSER_EXECUTABLE_PATH)) {
    throw new Error("BROWSER_EXECUTABLE_PATH is required");
  }

  const accessSync = deps.accessSync ?? fs.accessSync;
  const constants = deps.constants ?? fs.constants;

  accessSync(config.BROWSER_EXECUTABLE_PATH, constants.X_OK);

  if (!isProxyEnabled(config)) {
    return config;
  }

  if (isBlank(config.PROXY_IP) || isBlank(config.PROXY_PORT)) {
    throw new Error("PROXY_IP and PROXY_PORT are required when USE_PROXY=true");
  }

  const hasUsername = !isBlank(config.PROXY_USERNAME);
  const hasPassword = !isBlank(config.PROXY_PASSWORD);

  if (hasUsername !== hasPassword) {
    throw new Error(
      "PROXY_USERNAME and PROXY_PASSWORD must both be set together"
    );
  }

  return config;
}

function buildProxyServerArg(config) {
  if (!isProxyEnabled(config)) {
    return null;
  }

  return `http://${config.PROXY_IP}:${config.PROXY_PORT}`;
}

function getProxyCredentials(config) {
  if (!isProxyEnabled(config)) {
    return null;
  }

  const hasUsername = !isBlank(config?.PROXY_USERNAME);
  const hasPassword = !isBlank(config?.PROXY_PASSWORD);

  if (!hasUsername || !hasPassword) {
    return null;
  }

  return {
    username: config.PROXY_USERNAME,
    password: config.PROXY_PASSWORD,
  };
}

module.exports = {
  validateRuntimeConfig,
  buildProxyServerArg,
  getProxyCredentials,
};
