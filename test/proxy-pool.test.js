const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createProxyPoolManager,
  loadProxyPoolEntries,
} = require("../src/browser/proxy-pool");

test("loadProxyPoolEntries parses anytls nodes from Clash-style YAML", () => {
  const entries = loadProxyPoolEntries(
    "/tmp/proxy_pool.yaml",
    {
      readFileSync: () => `
proxies:
  - {name: "hk-1", type: anytls, server: edge.example.com, port: 35101, password: secret, sni: dl.example.com, client-fingerprint: chrome, alpn: [h2, http/1.1], udp: true}
  - {name: "ss-1", type: ss, server: ss.example.com, port: 443, cipher: aes-128-gcm, password: pass, udp: true}
`,
      yamlLoad: () => ({
        proxies: [
          {
            name: "hk-1",
            type: "anytls",
            server: "edge.example.com",
            port: 35101,
            password: "secret",
            sni: "dl.example.com",
            "client-fingerprint": "chrome",
            alpn: ["h2", "http/1.1"],
            udp: true,
          },
          {
            name: "ss-1",
            type: "ss",
            server: "ss.example.com",
            port: 443,
            cipher: "aes-128-gcm",
            password: "pass",
            udp: true,
          },
        ],
      }),
    }
  );

  assert.deepEqual(entries, [
    {
      name: "hk-1",
      type: "anytls",
      server: "edge.example.com",
      port: 35101,
      password: "secret",
      sni: "dl.example.com",
      clientFingerprint: "chrome",
      alpn: ["h2", "http/1.1"],
      udp: true,
    },
    {
      name: "ss-1",
      type: "ss",
      server: "ss.example.com",
      port: 443,
      method: "aes-128-gcm",
      password: "pass",
      udp: true,
    },
  ]);
});

test("createProxyPoolManager starts sing-box for an anytls node and reuses the local socks proxy", async () => {
  const writes = [];
  const spawns = [];
  let closed = false;

  const manager = await createProxyPoolManager(
    {
      PROXY_POOL_CONFIG_FILE: "/tmp/proxy_pool.yaml",
      PROXY_POOL_STATE_DIR: "/tmp/proxy-state",
      SING_BOX_PATH: "/usr/bin/sing-box",
    },
    {
      loadProxyPoolEntries: () => [
        {
          name: "hk-1",
          type: "anytls",
          server: "edge.example.com",
          port: 35101,
          password: "secret",
          sni: "dl.example.com",
          clientFingerprint: "chrome",
          alpn: ["h2", "http/1.1"],
          udp: true,
        },
      ],
      pickProxyPoolEntry: async (entries) => entries[0],
      allocatePort: async () => 20001,
      waitForLocalPortReady: async (port) => {
        assert.equal(port, 20001);
      },
      fs: {
        promises: {
          mkdir: async () => {},
          mkdtemp: async () => "/tmp/proxy-state/run-1",
          writeFile: async (filePath, payload) => {
            writes.push({ filePath, payload: String(payload) });
          },
          rm: async () => {
            closed = true;
          },
        },
      },
      path: {
        join: (...parts) => parts.join("/"),
      },
      os: {
        tmpdir: () => "/tmp",
      },
      spawn: (command, args) => {
        const proc = {
          command,
          args,
          once() {},
          kill() {
            closed = true;
          },
        };
        spawns.push(proc);
        return proc;
      },
    }
  );

  const first = await manager.pickProxy();
  const second = await manager.pickProxy();

  assert.equal(first, "socks5://127.0.0.1:20001");
  assert.equal(second, "socks5://127.0.0.1:20001");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "/usr/bin/sing-box");
  assert.deepEqual(spawns[0].args, [
    "run",
    "-c",
    "/tmp/proxy-state/run-1/hk-1.json",
  ]);

  const configWrite = writes.find((entry) => entry.filePath.endsWith("hk-1.json"));
  const singBoxConfig = JSON.parse(configWrite.payload);
  assert.equal(singBoxConfig.outbounds[0].type, "anytls");
  assert.equal(singBoxConfig.outbounds[0].server, "edge.example.com");
  assert.equal(singBoxConfig.outbounds[0].server_port, 35101);
  assert.equal(singBoxConfig.outbounds[0].password, "secret");
  assert.equal(singBoxConfig.outbounds[0].tls.server_name, "dl.example.com");
  assert.deepEqual(singBoxConfig.outbounds[0].tls.alpn, ["h2", "http/1.1"]);
  assert.equal(singBoxConfig.outbounds[0].tls.utls.fingerprint, "chrome");

  await manager.close();
  assert.equal(closed, true);
});
