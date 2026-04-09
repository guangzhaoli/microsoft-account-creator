const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const childProcess = require("child_process");
const yaml = require("js-yaml");

const {
  normalizeProxyPool,
} = require("./runtime-config");

function loadProxyPoolEntries(filePath, deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const yamlLoad = deps.yamlLoad || yaml.load;
  const content = readFileSync(filePath, "utf8");
  const parsed = yamlLoad(content);
  const proxies = Array.isArray(parsed?.proxies) ? parsed.proxies : [];
  const entries = [];

  for (const proxy of proxies) {
    const type = String(proxy?.type || "").trim().toLowerCase();
    if (type === "anytls") {
      entries.push({
        name: String(proxy.name || "anytls-node").trim(),
        type: "anytls",
        server: String(proxy.server || "").trim(),
        port: Number.parseInt(proxy.port, 10),
        password: String(proxy.password || "").trim(),
        sni: String(proxy.sni || "").trim(),
        clientFingerprint: String(proxy["client-fingerprint"] || "chrome").trim(),
        alpn: Array.isArray(proxy.alpn)
          ? proxy.alpn.map((entry) => String(entry).trim()).filter(Boolean)
          : [],
        udp: proxy.udp !== false,
      });
      continue;
    }

    if (type === "ss") {
      entries.push({
        name: String(proxy.name || "ss-node").trim(),
        type: "ss",
        server: String(proxy.server || "").trim(),
        port: Number.parseInt(proxy.port, 10),
        method: String(proxy.cipher || proxy.method || "").trim(),
        password: String(proxy.password || "").trim(),
        udp: proxy.udp !== false,
      });
    }
  }

  return entries.filter(isUsableProxyNode);
}

async function createProxyPoolManager(config, deps = {}) {
  const pickProxyPoolEntry = deps.pickProxyPoolEntry || pickPoolEntry;
  const fsLib = deps.fs || fs;
  const pathLib = deps.path || path;
  const osLib = deps.os || os;
  const spawn = deps.spawn || childProcess.spawn;
  const allocatePort = deps.allocatePort || allocateLocalPort;
  const waitForProxyReady = deps.waitForLocalPortReady || waitForLocalPortReady;
  const directPool = normalizeProxyPool(config.PROXY_POOL);

  if (directPool.length > 0) {
    return {
      async pickProxy() {
        return pickProxyPoolEntry(directPool);
      },
      async close() {},
    };
  }

  const filePath = String(config.PROXY_POOL_CONFIG_FILE || "").trim();
  if (!filePath) {
    throw new Error("PROXY_POOL_CONFIG_FILE is required for managed proxy pools");
  }

  const entries =
    (deps.loadProxyPoolEntries || loadProxyPoolEntries)(filePath, deps) || [];
  if (entries.length === 0) {
    throw new Error("proxy pool config contains no usable nodes");
  }

  const stateDir = String(
    config.PROXY_POOL_STATE_DIR || pathLib.join(osLib.tmpdir(), "proxy-pool")
  ).trim();
  await fsLib.promises.mkdir(stateDir, { recursive: true });
  const runDir = await fsLib.promises.mkdtemp(pathLib.join(stateDir, "run-"));
  const started = new Map();

  return {
    async pickProxy() {
      const node = await pickProxyPoolEntry(entries);
      if (!node || typeof node !== "object") {
        throw new Error("proxy pool picker returned an invalid node");
      }

      const key = buildProxyNodeKey(node);
      const existing = started.get(key);
      if (existing) {
        return existing.url;
      }

      const localPort = await allocatePort();
      const configPath = pathLib.join(runDir, `${sanitizeNodeName(node.name)}.json`);
      const localProxyUrl = `socks5://127.0.0.1:${localPort}`;
      const singBoxConfig = buildSingBoxConfig(node, localPort);
      await fsLib.promises.writeFile(
        configPath,
        `${JSON.stringify(singBoxConfig, null, 2)}\n`,
        "utf8"
      );

      const processRef = spawn(config.SING_BOX_PATH, ["run", "-c", configPath], {
        stdio: "ignore",
      });
      started.set(key, {
        processRef,
        url: localProxyUrl,
      });
      await waitForProxyReady(localPort);
      return localProxyUrl;
    },

    async close() {
      for (const item of started.values()) {
        if (item?.processRef && typeof item.processRef.kill === "function") {
          item.processRef.kill("SIGTERM");
        }
      }
      await fsLib.promises.rm(runDir, { recursive: true, force: true });
    },
  };
}

function buildSingBoxConfig(node, localPort) {
  return {
    log: {
      disabled: true,
    },
    inbounds: [
      {
        type: "socks",
        tag: "socks-in",
        listen: "127.0.0.1",
        listen_port: localPort,
      },
    ],
    outbounds: [buildSingBoxOutbound(node)],
    route: {
      final: "proxy-out",
    },
  };
}

function buildSingBoxOutbound(node) {
  if (node.type === "anytls") {
    return {
      type: "anytls",
      tag: "proxy-out",
      server: node.server,
      server_port: node.port,
      password: node.password,
      tls: {
        enabled: true,
        server_name: node.sni,
        alpn: node.alpn,
        utls: {
          enabled: true,
          fingerprint: node.clientFingerprint || "chrome",
        },
      },
    };
  }

  if (node.type === "ss") {
    const outbound = {
      type: "shadowsocks",
      tag: "proxy-out",
      server: node.server,
      server_port: node.port,
      method: node.method,
      password: node.password,
    };
    if (node.udp === false) {
      outbound.network = "tcp";
    }
    return outbound;
  }

  throw new Error(`Unsupported proxy node type: ${node.type}`);
}

function isUsableProxyNode(node) {
  if (!node || !node.type || !node.server || !Number.isInteger(node.port)) {
    return false;
  }

  if (node.type === "anytls") {
    return Boolean(node.password && node.sni);
  }

  if (node.type === "ss") {
    return Boolean(node.password && node.method);
  }

  return false;
}

function buildProxyNodeKey(node) {
  return [
    node.type,
    node.server,
    node.port,
    node.password,
    node.sni || "",
    node.method || "",
  ].join("|");
}

function sanitizeNodeName(name) {
  return String(name || "proxy-node")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proxy-node";
}

function pickPoolEntry(pool) {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error("proxy pool is empty");
  }

  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

async function allocateLocalPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForLocalPortReady(port, timeout = 5000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (ready) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for local proxy port ${port} to become ready`);
}

module.exports = {
  loadProxyPoolEntries,
  createProxyPoolManager,
  buildSingBoxConfig,
};
