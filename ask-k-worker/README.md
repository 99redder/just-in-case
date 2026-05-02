# Ask K — Just In Case dedicated worker

A standalone Cloudflare Worker that powers the "Ask K" assistant on the Just In
Case mobile view (`/index.html`). Runs separately from the main `just-in-case`
worker but binds to the same D1 database for session validation and to read the
live `app_data` row for grounding.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ask-k` | Bearer `jic_session` | Sends `{ message, history }` and returns `{ ok, reply }`. |

## Required configuration

| Name | How | Default |
|------|-----|---------|
| `ASKK_API_KEY` | `wrangler secret put ASKK_API_KEY` | — (required) |
| `ASKK_BASE_URL` | `[vars]` in `wrangler.toml` | `https://api.minimaxi.com/v1` |
| `ASKK_MODEL` | `[vars]` in `wrangler.toml` | `MiniMax-Text-01` |
| `DB` (D1 binding) | `[[d1_databases]]` in `wrangler.toml` | shares `just-in-case-db` |

The worker calls `${ASKK_BASE_URL}/chat/completions` with an OpenAI-style
payload. MiniMax's OpenAI-compatible host is the default; override the base URL
or model if you switch providers.

## First-time deploy

```bash
cd ask-k-worker

# 1. Set the API key (paste it when prompted)
wrangler secret put ASKK_API_KEY

# 2. Deploy
wrangler deploy
```

After the first deploy, Cloudflare prints the worker URL — typically
`https://just-in-case-askk.99redder.workers.dev`. Confirm it matches
`ASKK_API_URL` in `public/index.html`. If it doesn't, update that constant.

## Editing the knowledge base

`knowledge.md` is loaded into K's system prompt on every request via wrangler's
text-import rule. Edit it freely, then redeploy:

```bash
cd ask-k-worker
wrangler deploy
```

## How K answers

On every request the worker:

1. Validates the bearer token against the shared `sessions` table.
2. Loads the current `app_data` row from D1 and parses it as JSON.
3. Sends the system prompt, the static knowledge base, and the live JSON to the
   model. The live JSON always wins over the static text when they overlap.

Conversation history is held client-side and the last 10 turns are included in
each request. Nothing is persisted on the worker.
