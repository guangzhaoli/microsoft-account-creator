const fs = require("fs");

const PROXY_MODE_NONE = "none";
const PROXY_MODE_FIXED = "fixed";
const PROXY_MODE_POOL = "pool";
const SUPPORTED_PROXY_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks:",
  "socks4:",
  "socks5:",
]);

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeProxyMode(value) {
  switch (String(value || "").trim().toLowerCase()) {
    case "":
      return PROXY_MODE_NONE;
    case PROXY_MODE_NONE:
      return PROXY_MODE_NONE;
    case PROXY_MODE_FIXED:
      return PROXY_MODE_FIXED;
    case PROXY_MODE_POOL:
      return PROXY_MODE_POOL;
    default:
      return "";
  }
}

function isProxyEnabled(config) {
  return normalizeProxyMode(config?.PROXY_MODE) !== PROXY_MODE_NONE;
}

function isOauthEnabled(config) {
  return config?.ENABLE_OAUTH2 === true;
}

function getOauthScopes(config) {
  if (!Array.isArray(config?.OAUTH2_SCOPES)) {
    return [];
  }

  return config.OAUTH2_SCOPES
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter(Boolean);
}

function validateRuntimeConfig(config, deps = {}) {
  if (isBlank(config?.BROWSER_EXECUTABLE_PATH)) {
    throw new Error("BROWSER_EXECUTABLE_PATH is required");
  }

  const accessSync = deps.accessSync ?? fs.accessSync;
  const constants = deps.constants ?? fs.constants;

  try {
    accessSync(config.BROWSER_EXECUTABLE_PATH, constants.X_OK);
  } catch (error) {
    throw new Error(
      `BROWSER_EXECUTABLE_PATH is not executable: ${config.BROWSER_EXECUTABLE_PATH}`
    );
  }

  if (!isPositiveInteger(config?.COUNTS)) {
    throw new Error("COUNTS must be a positive integer");
  }

  if (!isPositiveInteger(config?.WORKERS)) {
    throw new Error("WORKERS must be a positive integer");
  }

  validateProxyConfig(config, { accessSync, constants });

  if (isOauthEnabled(config)) {
    if (isBlank(config?.OAUTH2_CLIENT_ID)) {
      throw new Error("OAUTH2_CLIENT_ID is required when ENABLE_OAUTH2=true");
    }

    if (isBlank(config?.OAUTH2_REDIRECT_URL)) {
      throw new Error("OAUTH2_REDIRECT_URL is required when ENABLE_OAUTH2=true");
    }

    if (getOauthScopes(config).length === 0) {
      throw new Error(
        "OAUTH2_SCOPES must contain at least one scope when ENABLE_OAUTH2=true"
      );
    }

    if (isBlank(config?.OAUTH_TOKENS_FILE)) {
      throw new Error("OAUTH_TOKENS_FILE is required when ENABLE_OAUTH2=true");
    }

    if (isBlank(config?.OAUTH_TOKENS_TEXT_FILE)) {
      throw new Error(
        "OAUTH_TOKENS_TEXT_FILE is required when ENABLE_OAUTH2=true"
      );
    }
  }

  return config;
}

function validateProxyConfig(config, deps = {}) {
  const mode = normalizeProxyMode(config?.PROXY_MODE);
  if (!mode) {
    throw new Error(`Unsupported PROXY_MODE: ${config?.PROXY_MODE}`);
  }

  if (mode === PROXY_MODE_NONE) {
    return;
  }

  if (mode === PROXY_MODE_FIXED) {
    if (isBlank(config?.PROXY)) {
      throw new Error("PROXY is required when PROXY_MODE=fixed");
    }

    parseProxyUrl(config.PROXY);
    return;
  }

  const pool = normalizeProxyPool(config?.PROXY_POOL);
  const poolConfigFile = String(config?.PROXY_POOL_CONFIG_FILE || "").trim();
  if (pool.length > 0 && poolConfigFile) {
    throw new Error(
      "PROXY_POOL and PROXY_POOL_CONFIG_FILE cannot be set together"
    );
  }

  if (pool.length === 0 && !poolConfigFile) {
    throw new Error(
      "PROXY_POOL or PROXY_POOL_CONFIG_FILE is required when PROXY_MODE=pool"
    );
  }

  for (const entry of pool) {
    parseProxyUrl(entry);
  }

  if (poolConfigFile) {
    if (isBlank(config?.SING_BOX_PATH)) {
      throw new Error(
        "SING_BOX_PATH is required when PROXY_POOL_CONFIG_FILE is set"
      );
    }
    try {
      deps.accessSync(config.SING_BOX_PATH, deps.constants.X_OK);
    } catch (error) {
      throw new Error(`SING_BOX_PATH is not executable: ${config.SING_BOX_PATH}`);
    }
  }
}

function parseProxyUrl(proxyUrl) {
  let parsed;
  try {
    parsed = new URL(String(proxyUrl).trim());
  } catch (error) {
    throw new Error(`Invalid proxy URL: ${proxyUrl}`);
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }

  if (parsed.username && !parsed.password) {
    throw new Error("proxy username and password must both be set together");
  }

  if (!parsed.username && parsed.password) {
    throw new Error("proxy username and password must both be set together");
  }

  if (!parsed.hostname || !parsed.port) {
    throw new Error(`Proxy URL must include host and port: ${proxyUrl}`);
  }

  return parsed;
}

function buildProxyServerArg(config) {
  const proxy = getFixedProxyValue(config);
  if (!proxy) {
    return null;
  }

  const parsed = parseProxyUrl(proxy);
  return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
}

function getProxyCredentials(config) {
  const proxy = getFixedProxyValue(config);
  if (!proxy) {
    return null;
  }

  const parsed = parseProxyUrl(proxy);
  if (!parsed.username) {
    return null;
  }

  return {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

function getFixedProxyValue(config) {
  if (normalizeProxyMode(config?.PROXY_MODE) !== PROXY_MODE_FIXED) {
    return null;
  }

  const proxy = String(config?.PROXY || "").trim();
  return proxy || null;
}

function normalizeProxyPool(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

async function resolveTaskProxy(config, deps = {}) {
  const mode = normalizeProxyMode(config?.PROXY_MODE);
  if (mode === PROXY_MODE_NONE) {
    return "";
  }
  if (mode === PROXY_MODE_FIXED) {
    const proxy = getFixedProxyValue(config);
    if (!proxy) {
      throw new Error("PROXY_MODE=fixed requires PROXY to be set");
    }
    return proxy;
  }
  if (mode === PROXY_MODE_POOL) {
    const pool = normalizeProxyPool(config?.PROXY_POOL);
    if (pool.length === 0) {
      throw new Error("PROXY_MODE=pool requires PROXY_POOL entries");
    }
    const picker = deps.pickProxyPoolEntry || pickProxyPoolEntry;
    return picker(pool);
  }

  throw new Error(`Unsupported PROXY_MODE: ${config?.PROXY_MODE}`);
}

function pickProxyPoolEntry(pool) {
  const normalized = normalizeProxyPool(pool);
  if (normalized.length === 0) {
    throw new Error("proxy pool is empty");
  }

  const index = Math.floor(Math.random() * normalized.length);
  return normalized[index];
}

function withResolvedProxy(config, proxy) {
  const clone = { ...config };
  clone.PROXY_MODE = proxy ? PROXY_MODE_FIXED : PROXY_MODE_NONE;
  clone.PROXY = proxy || "";
  clone.PROXY_POOL = [];
  clone.PROXY_POOL_CONFIG_FILE = "";
  return clone;
}

module.exports = {
  validateRuntimeConfig,
  buildProxyServerArg,
  getProxyCredentials,
  getFixedProxyValue,
  isOauthEnabled,
  getOauthScopes,
  normalizeProxyMode,
  normalizeProxyPool,
  resolveTaskProxy,
  withResolvedProxy,
  PROXY_MODE_NONE,
  PROXY_MODE_FIXED,
  PROXY_MODE_POOL,
};
