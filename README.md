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

Manifest permissions, in full: `storage`, `alarms`. The `scripting` permission is **optional** and only requested if you enable Gemini (see below).

### Two guarantee classes, stated honestly

Most platforms expose a usage endpoint, and for those TokenYou offers the strong guarantee — **architectural incapability**: no code of ours ever runs inside the page, so the extension *cannot* see your conversations even in principle. It only fetches the quota endpoint.

Gemini has no usage endpoint, so counting sends requires being present on the page — and any on-page script (ours or anyone's) *could* technically see page content. TokenYou's guarantee there is **behavioral and auditable** instead: a ~40-line script that emits an empty signal when the app sends a prompt, reads nothing else, and is plainly reviewable in this repo. Enabling Gemini also grants the optional `scripting` permission, scoped in practice to gemini.google.com; disabling Gemini returns it. The popup labels every platform with its class — "no page access" vs "on-page script" — so the choice is always informed and per-platform.

Either way, the invariant that never changes: **there is no exfiltration path**. TokenYou has no servers and makes no network requests except to the platforms you enabled, so no data can leave your browser regardless of guarantee class.

## Platforms

| Platform | Signal | Source |
|---|---|---|
| Claude (claude.ai) | Session + weekly + per-model %, reset times. Shared pool with Claude Code | `GET /api/organizations/{org}/usage` |
| ChatGPT (chatgpt.com) | 5-hour + weekly window %, reset times, plan | `GET /backend-api/wham/usage` |
| Grok (grok.com) | Remaining/total queries per rolling window | `POST /rest/rate-limits` |
| Perplexity | Remaining Pro / Research / Labs / Agentic searches | `GET /rest/rate-limit/all` |
| Gemini (gemini.google.com) | Prompts sent in the last 5 h / 7 days (local count) | Send-counter content script — no quota endpoint exists |

Gemini is the one platform without a usage endpoint, so TokenYou counts your sends locally: a page-world script watches for the app's own send request (`StreamGenerate`) and emits an **empty signal** — it never reads the request, your prompt, or the response. A bridge script records only a timestamp and the visible model name to local storage. That's the entire data flow, and it only exists if you enable Gemini (which is also when the optional `scripting` permission is requested). The card is marked "local count" because it can't see usage from other devices.

The other four are the platforms' own internal endpoints — the same data their web apps display. They are undocumented and can change; each adapter is isolated, so a breaking change degrades that one platform to "unavailable" while the rest keep working.

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
