<h1 align="center">
    <small>Microsoft/Outlook HQ Account Creator</small>
</h1>

<p align=center>
    <a href="https://github.com/silvestrodecaro/microsoft-account-creator/graphs/contributors" rel="nofollow"><img src="https://img.shields.io/github/contributors/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" alt="Contributors" data-canonical-src="https://img.shields.io/github/contributors/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" style="max-width: 100%;"></a>
    <a href="https://github.com/silvestrodecaro/microsoft-account-creator/network/members" rel="nofollow"><img src="https://img.shields.io/github/forks/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" alt="Forks" data-canonical-src="https://img.shields.io/github/forks/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" style="max-width: 100%;"></a>
    <a href="https://github.com/silvestrodecaro/microsoft-account-creator/stargazers" rel="nofollow"><img src="https://img.shields.io/github/stars/silvestrodecaro/microsoft-account-creator?style=for-the-badge" alt="Stargazers" data-canonical-src="https://img.shields.io/github/stars/silvestrodecaro/microsoft-account-creator?style=for-the-badge" style="max-width: 100%;"></a>
    <a href="https://github.com/silvestrodecaro/microsoft-account-creator/issues" rel="nofollow"><img src="https://img.shields.io/github/issues/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" alt="Issues" data-canonical-src="https://img.shields.io/github/issues/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" style="max-width: 100%;"></a>
    <a href="https://github.com/silvestrodecaro/microsoft-account-creator/blob/master/LICENSE" rel="nofollow"><img src="https://img.shields.io/github/license/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" alt="MIT License" data-canonical-src="https://img.shields.io/github/license/silvestrodecaro/microsoft-account-creator.svg?style=for-the-badge" style="max-width: 100%;"></a>
</p>

This project automates the creation of Microsoft accounts with [puppeteer](https://github.com/puppeteer/puppeteer) and a real Chromium or Chrome executable supplied by the operator. It generates accounts with realistic Italian names, surnames, and passwords, while keeping browser startup and browser-visible persona under explicit local control.

## ✨ Key Features

- Automatic generation of Microsoft accounts
- Use of real Italian names and surnames
- Creation of strong passwords using Italian words
- Option to add a recovery email (An automatically generated gmail on SMAIL PRO)
- Support for proxy usage

## 🛠 How It Works

![Example Screenshot][example-screenshot]

1. Navigate to the Outlook registration page
2. Input random Italian email, names, and surnames
3. Generate a random password using Italian words
4. Input a random birthday
5. Solve CAPTCHA (manual)
6. Optionally add a recovery email (An automatically generated gmail on SMAIL PRO)
7. Complete account creation

### Built With

[![Node.js][Node.js-badge]][Node.js-url]
[![Puppeteer][Puppeteer-badge]][Puppeteer-url]

## 🚀 Getting Started

### Prerequisites

- Node.js (version 12 or higher)
- A local Chromium or Chrome executable path

### Installation

```sh
# Clone the repository
git clone https://github.com/silvestrodecaro/microsoft-account-creator.git
cd microsoft-account-creator

# Install dependencies
npm install
```

### Running

```sh
node .
```

Before running, set `BROWSER_EXECUTABLE_PATH` in [`src/config.js`](src/config.js) to the exact Chromium or Chrome executable you want Puppeteer to launch.

Example:

```js
module.exports = {
  BROWSER_EXECUTABLE_PATH: "/home/lucas/Downloads/ungoogled-chromium-144.0.7559.132-1-x86_64_linux/chrome",
  ADD_RECOVERY_EMAIL: false,
  MANUAL_VERIFICATION: true,
  ENABLE_OAUTH2: false,
  OAUTH2_CLIENT_ID: "",
  OAUTH2_REDIRECT_URL: "",
  OAUTH2_SCOPES: [
    "offline_access",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
  ],
  OAUTH_TOKENS_FILE: "oauth_tokens.jsonl",
  USE_PROXY: false,
};
```

The runtime now fails hard when the browser path is missing, invalid, or not executable. It does not auto-discover browsers and does not fall back to a bundled browser.

## 🔧 Configuration

### CAPTCHA

The automatic CAPTCHA solving feature is no longer supported. Following a removal request from the CAPTCHA provider previously included in this repository, I have decided to exclude any CAPTCHA solver from this project. Don't worry - you can easily solve the CAPTCHA manually when prompted during the account creation process.

### Proxy

To use a proxy:

1. Open the [`config.js`](src/config.js#L3) file
2. Set `USE_PROXY: true`
3. Set `PROXY_IP` and `PROXY_PORT`
4. If your proxy requires authentication, set both `PROXY_USERNAME` and `PROXY_PASSWORD`

> Note: Partial proxy credentials are rejected at startup.

### Recovery Email

To disable adding a recovery email:

1. Open the [`config.js`](src/config.js#L2) file
2. Set `ADD_RECOVERY_EMAIL: false`

> Note: Disabling the recovery email is not recommended.

### OAuth2

To enable Microsoft OAuth2 token capture after registration:

1. Open the [`config.js`](src/config.js) file
2. Set `ENABLE_OAUTH2: true`
3. Fill `OAUTH2_CLIENT_ID`
4. Fill `OAUTH2_REDIRECT_URL`
5. Adjust `OAUTH2_SCOPES` as needed
6. Set `OAUTH_TOKENS_FILE` to the output file you want

> Note: When `ENABLE_OAUTH2=true`, startup fails hard if any OAuth2 field is incomplete.

## ⚠️ Warnings

- Ensure the Chromium or Chrome executable in `BROWSER_EXECUTABLE_PATH` is valid and executable before launching the tool.
- Using this tool may violate Microsoft's Terms of Service. Use at your own risk.

## 🤝 Contributing

Contributions are welcome! To contribute:

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📜 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

## 📞 Contact

[![LinkedIn][linkedin-shield]][linkedin-url]

[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/silvestro-decaro
[Puppeteer-badge]: https://img.shields.io/badge/Puppeteer-40B5A4?logo=puppeteer&logoColor=fff&style=for-the-badge
[Puppeteer-url]: https://github.com/puppeteer/puppeteer
[Node.js-badge]: https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=fff&style=for-the-badge
[Node.js-url]: https://nodejs.org
[example-screenshot]: /assets/example.gif
