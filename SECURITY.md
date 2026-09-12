# TDCanvas Security Policy

## Supported versions

TDCanvas is under active development. Security fixes target the `main` branch and the latest tagged release. Older versions are supported on a best-effort basis.

## Reporting a vulnerability

Do not publish exploit details, credentials, private API keys, proof-of-concept code, sensitive screenshots, or real user data in a public issue.

Use one of these channels:

1. GitHub private vulnerability reporting or a GitHub Security Advisory for this repository, when available.
2. Another private maintainer channel configured for the repository.
3. If no private channel is available, open a public issue requesting private contact and omit all technical exploit details.

Include the affected version or commit, reproduction steps, impact, relevant redacted evidence, and whether the issue affects local use, hosted deployment, browser storage, WebDAV sync, provider configuration, or proxy behavior.

## Scope

TDCanvas supports third-party node plugins loaded from remote URLs. Installed plugin code runs in the web application and can access page data, including locally stored provider credentials. This is an intentional extensibility trade-off, so only install plugins from sources you trust.

In-scope reports include:

- Cross-site scripting or unintended credential exposure in project code.
- Plugin code running without the required installation confirmation.
- Unsafe file handling, import/export behavior, WebDAV proxy behavior, or access control.
- An exploitable supply-chain issue in code or default configuration shipped by this repository.

Usually out of scope:

- Malicious behavior by a plugin the user explicitly trusted and installed.
- Vulnerabilities in third-party providers, hosting platforms, or browser extensions.
- Compromise of a user's credentials outside TDCanvas.
- Reports without a practical security impact.

## Disclosure

TDTV maintainers aim to acknowledge valid reports within seven days and coordinate a fix before public disclosure. Timelines are best effort. Please allow time for investigation and remediation before publishing details.
