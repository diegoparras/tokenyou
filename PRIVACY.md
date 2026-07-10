# TokenYou — Privacy Policy

**TL;DR: everything stays in your browser. Nothing leaves it.**

- TokenYou has **no servers, no analytics, no telemetry, no heartbeat**. It makes zero network requests to anyone other than the AI platforms you explicitly enable.
- When you enable a platform, TokenYou reads **only that platform's usage/quota endpoint** (numbers and reset times). It never reads, stores, or transmits your conversations, prompts, or personal data.
- Every platform, Gemini included, is read the same way: background fetches to that platform's usage endpoint, with **no code running on the page at all**. Gemini needs two tokens from its app HTML to call its usage RPC; TokenYou reads only those tokens and the resulting quota numbers, never your conversations.
- TokenYou never reads your cookies. Requests to a platform are same-origin fetches where your browser attaches the session automatically — the extension has no access to the credential itself.
- All data (usage percentages, reset timestamps) is stored in `chrome.storage.local` on your device and never synced or uploaded.
- The default installation requests access to **no websites at all**. Each platform is an optional permission you grant one by one and can revoke at any time.

Questions: open an issue on the repository.
