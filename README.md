# TokenYou 🔋

**All your AI usage limits in one place. Verifiably private.**

TokenYou is a Chrome (MV3) extension that shows how much of your usage limits you've consumed on Claude, ChatGPT, Grok and Perplexity — session windows, weekly caps, remaining searches — with reset countdowns and a toolbar badge showing your most critical meter.

It exists because this category has a trust problem: usage trackers run next to your AI conversations and your authenticated sessions, and most of them are closed-source, over-permissioned, or both. TokenYou is designed so you don't have to trust it.

## The security model

| | Typical tracker | TokenYou |
|---|---|---|
| Default site access | All target sites, sometimes `<all_urls>` | **None** — each platform is an optional permission you grant one by one |
| Cookies permission | Often requested | **Never** — same-origin fetches let the browser attach the session; the extension can't read it |
| What it reads | Network interception / DOM scraping | **Only the platform's usage endpoint** (numbers and reset times) |
| Your conversations | Visible to the extension | **Never touched** |
| Telemetry | Analytics, heartbeats | **Zero network traffic** except to platforms you enabled |
| Code | Closed | MIT, this repo, **reproducible build** (`git archive`, hash published per release) |

Manifest permissions, in full: `storage`, `alarms`. That's it.

## Platforms

| Platform | Signal | Source |
|---|---|---|
| Claude (claude.ai) | Session + weekly + per-model %, reset times. Shared pool with Claude Code | `GET /api/organizations/{org}/usage` |
| ChatGPT (chatgpt.com) | 5-hour + weekly window %, reset times, plan | `GET /backend-api/wham/usage` |
| Grok (grok.com) | Remaining/total queries per rolling window | `POST /rest/rate-limits` |
| Perplexity | Remaining Pro / Research / Labs / Agentic searches | `GET /rest/rate-limit/all` |

These are the platforms' own internal endpoints — the same data their web apps display. They are undocumented and can change; each adapter is isolated, so a breaking change degrades that one platform to "unavailable" while the rest keep working.

## Efficiency

- Event-driven MV3 service worker: refreshes via `chrome.alarms` (5 min) and on popup open. No resident polling loop — the extension sleeps between refreshes.
- Vanilla JavaScript with JSDoc types. No frameworks, no runtime dependencies, no build step: what you read in `src/` is exactly what runs.
- Whole extension under 30 KB of code.

## Install (development)

1. Clone this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the repo folder.
4. Click the TokenYou icon and enable the platforms you use.

## Verify a release

Releases are packed with `git archive` from a tagged commit, so the zip is byte-reproducible:

```sh
git archive --format=zip -o tokenyou.zip <tag> manifest.json src icons _locales LICENSE
sha256sum tokenyou.zip   # compare with the hash published in the release
```

## Contributing

Adapters live in [src/adapters/](src/adapters/) — one file per platform, returning the normalized snapshot defined in [src/lib/quota.js](src/lib/quota.js). PRs adding platforms are welcome as long as they respect the security model: usage endpoints only, no conversation data, no new permissions beyond an optional host.

Type checking: `npm install && npm run typecheck`.

## License

[MIT](LICENSE) — © 2026 Diego Parras and TokenYou contributors.

*Privacy policy: [PRIVACY.md](PRIVACY.md). TokenYou is a read-only monitor of your own quota. It does not and will not help bypass platform limits.*
