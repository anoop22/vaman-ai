# Security

## Threat Model

Vaman AI is a **personal assistant** designed to run on a single machine or private server. The gateway is not designed for public internet exposure.

## Architecture

- **Gateway binds to `127.0.0.1`** (localhost only) by default via `GATEWAY_HOST` in config.
- **Remote access** is via SSH tunnel only (e.g., `ssh -L 18789:127.0.0.1:18790`).
- **API and WebSocket routes are unauthenticated** — they rely on the network boundary (localhost + SSH) for access control.

## Rules

1. **Never expose port 18790 to the internet.** The `/api/*` and WebSocket endpoints have no auth. Exposing them allows full control of the agent, sessions, and configuration.
2. **Never open port 18790 in cloud security groups** (AWS, GCP, etc.). Keep it internal.
3. **If you need remote access**, use an SSH tunnel. Do not add a reverse proxy without adding authentication first.
4. **Keep `.env` out of git.** It contains API keys. The `.gitignore` already covers this.
5. **Keep `data/oauth/` and `data/state/` out of git.** These contain credentials and personal profile data. The `.gitignore` covers this.

## Known Accepted Risks

| Risk | Status | Mitigation |
|------|--------|------------|
| Unauthenticated API/WS | Accepted | Gateway is localhost-only, accessed via SSH tunnel |
| npm audit: undici (moderate) | Accepted | Transitive dep via discord.js, no direct fix available |

## Reporting

If you find a security issue, open a GitHub issue or contact the maintainer directly.
