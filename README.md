# TokenYou 🔋

**All your AI usage limits in one place. Verifiably private.**

Website: [getescriba.com/tokenyou](https://getescriba.com/tokenyou) · Part of the [Escriba ecosystem](https://getescriba.com).

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

### One guarantee: no code on any page

For every platform, TokenYou offers the same strong guarantee — **architectural incapability**. No code of ours ever runs inside any site's page. The extension only makes background fetches to each platform's usage endpoint and reads the quota numbers back. It *cannot* see your conversations even in principle, because it is never present where they are.

And the invariant on top of that: **there is no exfiltration path**. TokenYou has no servers and makes no network requests except to the platforms you enabled, so no data can leave your browser.

## Platforms

| Platform | Signal | Source |
|---|---|---|
| Claude (claude.ai) | Session + weekly + per-model %, reset times. Shared pool with Claude Code | `GET /api/organizations/{org}/usage` |
| ChatGPT (chatgpt.com) | 5-hour + weekly window %, reset times, plan | `GET /backend-api/wham/usage` |
| Grok (grok.com) | Remaining/total queries per rolling window | `POST /rest/rate-limits` |
| Perplexity | Remaining Pro / Research / Labs / Agentic searches | `GET /rest/rate-limit/all` |
| Gemini (gemini.google.com) | Current (5 h) + weekly compute usage %, reset times | Boq `jSf9Qc` RPC via `batchexecute` |

Claude also shows your **extra usage** spending (monthly overage credits, e.g. `$21.84 / $100.00`) when it's enabled on your plan.

Gemini has no plain GET usage endpoint; its usage page is powered by an internal Boq RPC (`jSf9Qc`) that needs two tokens embedded in the app's HTML (`SNlM0e`, `cfb2h`). TokenYou fetches the HTML, extracts those tokens, and calls the RPC — no page script, no conversation access, same "read only the quota" model as the rest.

### Custom services (advanced)

Options page → define additional services as JSON: an origin, a usage URL on that host, and meters mapped with dot-paths into the JSON response (`pctPath`, or `usedPath`/`remainingPath` + `totalPath`, plus optional `resetPath`). A Cursor template ships as a starting point (community-verified — its endpoint shape may need adjusting; use the Test button, which requests the permission and shows exactly what was read).

Custom services follow the same rules as built-ins: https only, endpoint host must match the granted origin, enabled per-site from the popup, revocable anytime. To make user-defined origins grantable at runtime, the manifest declares `https://*/*` under `optional_host_permissions` — this grants **nothing** by itself; every origin still requires an explicit per-site permission dialog.

### Hiding meters

Each platform card has a gear: toggle any meter (a model you don't use, a search type you don't care about) off. Hidden meters are excluded from the toolbar badge.

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
