# Microsoft Account Creator

一个基于 `puppeteer` 的本地自动化仓库，用真实的 Chromium/Chrome 可执行文件驱动微软注册流程。当前这份代码已经不是上游 README 描述的那套旧实现，而是围绕以下几个实际模块工作的：

- `src/browser/session.js`：启动真实浏览器、创建临时 profile、挂载浏览器参数
- `src/browser/fingerprint.js`：生成浏览器 persona 和启动参数
- `src/browser/runtime-config.js`：集中校验运行配置，缺项直接失败
- `src/browser/proxy-pool.js`：管理固定代理 / 代理池 / `sing-box` 动态本地 SOCKS5
- `src/index.js`：执行注册主流程、处理验证页、落盘账号与 OAuth2 token
- `src/oauth2.js`：注册完成后执行 OAuth2 授权码交换并保存 token

这份仓库的核心特点是：**显式配置、真实浏览器、失败即报错，不做静默兜底**。

## 当前功能边界

当前仓库真实支持的能力：

- 使用本地 Chromium/Chrome 可执行文件启动浏览器
- 跟随当前 `signup.live.com/signup` 流程填写邮箱、密码、生日、姓名
- 使用英文名库生成注册信息
- 使用本地词库生成密码
- 支持以下代理模式：
  - `none`：不走代理
  - `fixed`：固定单代理
  - `pool`：从 `PROXY_POOL` 随机选，或从 Clash 风格 YAML 启动 `sing-box` 本地 SOCKS5
- 默认支持手动处理验证页面
- 可选在注册完成后执行 OAuth2 并保存 token
- 可选添加恢复邮箱

当前仓库不再适合沿用旧 README 里的这些说法：

- 不是旧的指纹浏览器依赖方案
- 不是旧的 `USE_PROXY / PROXY_IP / PROXY_PORT` 配置格式
- 不是“自动发现浏览器路径”的运行方式
- 不是“意大利名字/姓氏”生成逻辑

## 环境要求

- Node.js `>=18`
- 一个本地可执行的 Chromium / Chrome 路径
- 如果使用 YAML 代理池，需要可执行的 `sing-box`
- 如果启用恢复邮箱，需要设置环境变量 `RAPIDAPI_KEY`

当前默认配置明显偏向 Linux / Ubuntu 风格的 Chromium persona，因此如果你直接使用仓库里的 `src/config.js`，需要先替换其中的本机路径和本机参数。

## 安装

```bash
git clone https://github.com/guangzhaoli/microsoft-account-creator.git
cd microsoft-account-creator
npm install
```

## 快速开始

主入口是：

```bash
node .
```

运行前先编辑 `src/config.js`。

一个最小可跑的本地示例可以长这样：

```js
module.exports = {
  BROWSER_EXECUTABLE_PATH: "/path/to/chrome",
  COUNTS: 1,
  WORKERS: 1,

  FINGERPRINT_PLATFORM: "linux",
  FINGERPRINT_PLATFORM_VERSION: "24.04.4",
  FINGERPRINT_BRAND: "Chrome",
  FINGERPRINT_LANGUAGE: "en-US",
  FINGERPRINT_ACCEPT_LANGUAGE: "en-US,en",
  FINGERPRINT_WEBGL_VENDOR: "Google Inc. (Mesa)",
  FINGERPRINT_WEBGL_RENDERER: "ANGLE (Mesa, Vulkan 1.3)",
  FINGERPRINT_DISABLE_SPOOFING: [],

  ADD_RECOVERY_EMAIL: false,
  MANUAL_VERIFICATION: true,
  HIDE_BROWSER_UNTIL_VERIFICATION: false,

  ENABLE_OAUTH2: false,
  OAUTH2_CLIENT_ID: "",
  OAUTH2_REDIRECT_URL: "",
  OAUTH2_SCOPES: [],
  OAUTH_TOKENS_FILE: "oauth_tokens.jsonl",
  OAUTH_TOKENS_TEXT_FILE: "oauth_tokens.txt",

  PROXY_MODE: "none",
  PROXY: "",
  PROXY_POOL: [],
  PROXY_POOL_CONFIG_FILE: "",
  PROXY_POOL_STATE_DIR: "config/.runtime/proxy_pool",
  SING_BOX_PATH: "/path/to/sing-box",

  WORDS_FILE: "src/Utils/words5char.txt",
  ACCOUNTS_FILE: "accounts.txt",
};
```

## 配置说明

### 1. 浏览器与运行并发

必填项：

- `BROWSER_EXECUTABLE_PATH`：本地浏览器可执行文件路径
- `COUNTS`：目标成功注册数量
- `WORKERS`：并发 worker 数

这里的行为是 fail-fast：

- 浏览器路径为空：直接报错
- 浏览器路径不可执行：直接报错
- `COUNTS` / `WORKERS` 不是正整数：直接报错

### 2. 浏览器 persona / 指纹相关配置

当前实现不会注入一个庞大的脚本式伪装层，`buildInjectionScript()` 现在默认返回空字符串。浏览器 persona 主要通过启动参数和配置值控制：

- `FINGERPRINT_PLATFORM`
- `FINGERPRINT_PLATFORM_VERSION`
- `FINGERPRINT_BRAND`
- `FINGERPRINT_LANGUAGE`
- `FINGERPRINT_ACCEPT_LANGUAGE`
- `FINGERPRINT_WEBGL_VENDOR`
- `FINGERPRINT_WEBGL_RENDERER`
- `FINGERPRINT_DISABLE_SPOOFING`

另外会为每次运行生成：

- 随机桌面窗口尺寸
- 浏览器版本识别
- 时区（无代理时取本机；固定代理时可按代理出口解析）
- 硬件并发信息

### 3. 代理配置

当前只支持 `PROXY_MODE` 这一套配置，不再使用旧的 `USE_PROXY` 风格字段。

### 模式 A：不使用代理

```js
PROXY_MODE: "none",
```

### 模式 B：固定代理

```js
PROXY_MODE: "fixed",
PROXY: "http://user:password@127.0.0.1:7890",
```

支持协议：

- `http://`
- `https://`
- `socks://`
- `socks4://`
- `socks5://`

限制：

- 必须同时提供用户名和密码，不能只填一个
- 必须包含 host 和 port
- 协议不支持就会直接报错

### 模式 C：内存代理池

```js
PROXY_MODE: "pool",
PROXY_POOL: [
  "http://127.0.0.1:7890",
  "socks5://127.0.0.1:1080",
],
```

每次 attempt 会从池里选一个代理，然后冻结成该次任务自己的固定代理。

### 模式 D：YAML 代理池 + sing-box

```js
PROXY_MODE: "pool",
PROXY_POOL: [],
PROXY_POOL_CONFIG_FILE: "config/proxy_pool.yaml",
PROXY_POOL_STATE_DIR: "config/.runtime/proxy_pool",
SING_BOX_PATH: "/usr/bin/sing-box",
```

这里会读取 Clash 风格 `proxies:` 列表，当前解析器只认两类节点：

- `anytls`
- `ss`

典型 YAML 结构示例：

```yaml
proxies:
  - name: hk-1
    type: anytls
    server: edge.example.com
    port: 35101
    password: secret
    sni: dl.example.com
    client-fingerprint: chrome
    alpn: [h2, http/1.1]
    udp: true

  - name: ss-1
    type: ss
    server: ss.example.com
    port: 443
    cipher: aes-128-gcm
    password: pass
    udp: true
```

运行时会：

1. 从 YAML 中抽取可用节点
2. 为选中的节点生成临时 `sing-box` 配置
3. 在本地起一个临时 SOCKS5 入口
4. 把这次注册 attempt 绑定到对应的本地代理
5. 在任务结束时清理临时运行目录

### 4. 验证页配置

- `MANUAL_VERIFICATION: true`
  - 验证阶段交给你在浏览器里手动完成
- `MANUAL_VERIFICATION: false`
  - 会尝试自动处理当前的 press-and-hold 验证流
- `HIDE_BROWSER_UNTIL_VERIFICATION: true`
  - 浏览器会在验证前隐藏，到需要人工操作时再显示

注册流程里还包含：

- 验证后页面跳转处理
- privacy notice 页面按钮处理
- post-login onboarding / account checkup 页面处理

也就是说，这个仓库不是只停在“提交表单”，而是会继续尝试走到 post-login landing page。

### 5. 恢复邮箱

启用方式：

```js
ADD_RECOVERY_EMAIL: true,
```

同时你需要在运行前设置：

```bash
export RAPIDAPI_KEY=your_key_here
```

当前恢复邮箱流程依赖 `src/Utils/recMail.js`，会调用外部邮箱接口生成邮箱并读取验证码。如果没有设置 `RAPIDAPI_KEY`，代码会直接报错，不会兜底。

### 6. OAuth2 token 落盘

启用方式：

```js
ENABLE_OAUTH2: true,
OAUTH2_CLIENT_ID: "...",
OAUTH2_REDIRECT_URL: "http://localhost:5173",
OAUTH2_SCOPES: [
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read",
],
OAUTH_TOKENS_FILE: "oauth_tokens.jsonl",
OAUTH_TOKENS_TEXT_FILE: "oauth_tokens.txt",
```

启用后会在注册成功并进入 post-login 页面后继续：

1. 走 OAuth2 authorize
2. 自动处理常见登录 / consent / stay-signed-in 页面
3. 用授权码换 token
4. 同时写入两个输出文件

输出文件说明：

- `OAUTH_TOKENS_FILE`
  - JSONL 结构，包含 `email`、`password`、`client_id`、`refresh_token`、`access_token`、`expires_at`、`scope`
- `OAUTH_TOKENS_TEXT_FILE`
  - 纯文本格式：`email----password----clientId----refreshToken`

同样是 fail-fast：

- `ENABLE_OAUTH2=true` 时，`CLIENT_ID / REDIRECT_URL / SCOPES / OUTPUT FILES` 缺任意一个都会直接报错

### 7. 当前配置里的兼容字段

- `WORDS_FILE` 当前仍然被主流程使用，用于拼接随机密码
- `ACCOUNTS_FILE` 当前仍然被主流程使用，用于落盘 `email:password`
- `NAMES_FILE` 目前保留在 `src/config.js` 里，但当前主流程并不读取它；姓名来源实际是 `src/Utils/english-names.js`

## 运行流程

当前主流程大致是：

1. `start()` 校验配置
2. 根据 `PROXY_MODE` 准备固定代理或代理池
3. 每个 worker 启动一次 `BrowserSession`
4. 打开 `https://signup.live.com/signup`
5. 填写邮箱、密码、生日、姓名
6. 进入验证页
7. 处理验证后的隐私页 / onboarding / account-checkup 页面
8. 进入落地页后：
   - 写入 `accounts.txt`
   - 可选添加恢复邮箱
   - 可选执行 OAuth2 并保存 token
9. 清理临时浏览器 profile 和代理池运行状态

## 输出文件与本地运行痕迹

常见输出：

- `accounts.txt`：`email:password`
- `oauth_tokens.jsonl`
- `oauth_tokens.txt`
- `config/.runtime/proxy_pool/`：代理池临时状态目录

当前仓库已经把下面这些本地运行产物列入忽略范围，不建议公开提交：

- `.claude/`
- `.codex/`
- `config/.runtime/`
- `config/proxy_pool_residential.yaml`
- `oauth_tokens.jsonl`
- `oauth_tokens.txt`
- `tmp-*.png`

## 测试

仓库当前使用的是 Node 原生测试：

```bash
npm test
```

现有测试覆盖的重点包括：

- 启动配置校验
- BrowserSession 生命周期
- 浏览器启动参数
- 代理池解析和 `sing-box` 管理
- OAuth2 token 写入
- post-login landing 相关逻辑

## 仓库结构

```text
.
├── README.md
├── package.json
├── config/
│   ├── proxy_pool.yaml
├── src/
│   ├── config.js
│   ├── index.js
│   ├── oauth2.js
│   ├── browser/
│   │   ├── fingerprint.js
│   │   ├── proxy-pool.js
│   │   ├── runtime-config.js
│   │   └── session.js
│   └── Utils/
└── test/
```

## 许可证

本仓库附带的许可证文件是 `MIT`，见 [`LICENSE`](LICENSE)。
