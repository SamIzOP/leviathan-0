# Deployment

The server serves HTTP, `/health`, static assets and `/ws` on one port. The browser derives `ws`/`wss` from its page URL. Use one process and one instance: rooms are in memory, with no persistence across a restart or redeploy.

## Render (primary)

1. **You: create or sign into a GitHub/GitLab account and Render account.** No provider credentials were supplied with this project, so an actual public deployment cannot be completed from this workspace.
2. **You: create a repository and authorize access to it.** Push this folder, including `package-lock.json`, `Dockerfile` and `render.yaml`. Exclude `.env` and `node_modules`. If you use GitHub Desktop, add this folder and choose Publish repository.
3. **You: in Render choose New → Blueprint, connect the repository, and approve the free service declared in `render.yaml`.** No build/start fields or secrets need to be entered. Use one instance.
4. Render builds the Docker image, checks `/health`, supplies `PORT`, and gives you an HTTPS `onrender.com` link. Open it, enter a callsign, create a room, and copy the invite link to friends. Future pushes deploy automatically.
5. Verify `/health` returns `ok: true`, and test two clients before sharing more widely. Keep `DEV_SOLO` and `DEV_TOOLS` false publicly.

Free Render services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Open the link before inviting friends. Sleeping, restarts and redeploys erase in-memory rooms; the 45-second reconnect window only works while the same process survives. For dependable sessions use an always-on paid instance. Free services also have resource and usage limits; check your dashboard before relying on them for a larger audience.

Verified against [Render free-instance documentation](https://render.com/docs/free), [WebSockets](https://render.com/docs/websocket), and [Blueprint reference](https://render.com/docs/blueprint-spec) on 2026-10-18. Hosting policies may change.

## Local production / Docker

```sh
npm install
npm run build
npm start
# http://localhost:3000
```

```sh
docker build -t leviathan-0 .
docker run --rm -p 3000:3000 -e PORT=3000 leviathan-0
```

## Alternatives

Railway: connect this repository as a service and use its Dockerfile; generate a public domain and configure `/health` as the health check. Keep one replica. An account and any required billing approval are manual steps. Do not assume a permanent free tier.

Fly.io: install/sign in with its CLI, run `fly launch --no-deploy`, use internal port 3000, keep one machine, and run `fly deploy`. Configure an HTTP service health check at `/health`. Account/billing authorization and choosing the application name/region are manual. Review current pricing before launching.

No database, external storage, environment secrets, or separate WebSocket service is required for this foundation.
