# Deploy OmniLaya for free

The whole stack runs at no cost:

| Part | Where | Free limit |
| --- | --- | --- |
| Website and `/api/ask` | Cloudflare Workers, free plan | 100,000 requests a day; 10 ms CPU per request, and waiting on the network does not count |
| Laya (`laya-serve`) | Oracle Cloud Always Free ARM server | 2 OCPU and 12 GB RAM, enough for both Laya checkpoints |
| Search results | SearXNG on the same server | No limit of its own; engines may throttle a busy server |
| HTTPS | Caddy with `sslip.io` hostnames | Let's Encrypt certificates, no domain or extra account needed |

You do two things by hand, because they need your own accounts: create the Oracle server, and click "Allow" once when Cloudflare asks. Everything else is scripted. For searches as fast as Jev Search, see [Fast option](#fast-option-laya-on-modal-like-jevs-hosted-api) below.

Expect a search to take 5 to 15 seconds: the free server has no GPU. Everything else is the same as local development.

## 1. Create the free server (Oracle Cloud)

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Oracle asks for a card to verify you; Always Free resources are not charged.
2. Create a compute instance:
   - Image: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM), **2 OCPU, 12 GB memory**
   - Add your SSH public key, and note the public IP.
   - If Oracle says "out of capacity", try another availability domain or try again later.
3. Open the web ports: in the instance's **Virtual Cloud Network → Security List**, add two ingress rules, source `0.0.0.0/0`, TCP, destination ports **80** and **443**.

## 2. Start Laya and SearXNG on the server

From the `Omni-Laya` folder on your computer (replace `1.2.3.4` with the server's IP):

```bash
scp -r deploy/server ubuntu@1.2.3.4:~/omnilaya-server
ssh ubuntu@1.2.3.4 "sudo bash ~/omnilaya-server/setup.sh"
scp ubuntu@1.2.3.4:~/omnilaya-server/omnilaya-secrets.env .
```

`setup.sh`:

- installs Docker and opens ports 80 and 443 in the server's own firewall
- creates random keys for Laya and SearXNG and keeps them in `.env`
- starts Laya, SearXNG and Caddy at `https://laya.1-2-3-4.sslip.io` and `https://search.1-2-3-4.sslip.io`
- waits for Laya to download its checkpoints (about 3 GB, first start only)
- checks both services, then writes `omnilaya-secrets.env` with the values for the next step

`omnilaya-secrets.env` holds your keys. It is ignored by Git; do not share it.

## 3. Deploy the website (Cloudflare Workers)

Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) if you do not have one. Then, in the `Omni-Laya` folder:

```bash
pnpm install --frozen-lockfile
pnpm deploy:free ./omnilaya-secrets.env
```

The first run opens your browser for `wrangler login`; click Allow. The script then:

- creates the KV namespace for the result cache and writes its ID into `wrangler.jsonc`
- builds and deploys the Worker to `https://omnilaya-search.<your-subdomain>.workers.dev`
- uploads the Laya and SearXNG settings as Worker secrets
- points the canonical links, `robots.txt` and the sitemap at that address and redeploys
- runs one search and prints what Laya chose

When it prints `Live: https://...`, the site is up for anyone.

On Windows on ARM64, run the pnpm commands with an x64 build of Node.js; Cloudflare's local tools have no ARM64 Windows build.

## Fast option: Laya on Modal, like Jev's hosted API

Jev Search is fast because its model runs on hosted GPUs. The same works for Laya on [Modal](https://modal.com/pricing): a serverless container that starts when a search needs it and stops when idle. Modal gives $30 of compute a month for free. No server to manage; this replaces steps 1 and 2.

```bash
pip install modal
python deploy/modal/deploy.py --gpu T4      # or leave out --gpu for CPU
# add SEARCH1API_API_KEY to omnilaya-secrets.env, then:
pnpm deploy:free ./omnilaya-secrets.env
```

The first run opens a browser to sign in to Modal. The helper creates the Laya key, deploys `deploy/modal/laya_modal.py`, waits for the endpoint to answer and writes its address and key into `omnilaya-secrets.env`. Search results then come from Search1API, as on Jev Search.

| Setting | Search speed | Cost on Modal | Free credit covers |
| --- | --- | --- | --- |
| CPU, scale to zero (default) | a few seconds; 20 to 40 s after an idle spell | about $0.08 per active hour | about 380 active hours a month |
| `--gpu T4`, scale to zero | about 1.5 to 3 s; 20 to 40 s after an idle spell | about $0.59 per active hour | about 50 active hours a month |
| `--gpu T4 --warm 1` | about 1.5 to 3 s, no cold starts | about $14 a day | not covered: paid |

`--idle` sets how long a container waits for the next search before stopping (default 300 seconds). A longer wait means fewer cold starts and more credit used. Searches repeated within six hours skip Laya entirely: OmniLaya caches Laya's judgments in the Worker's KV store.

## Options

**Use Search1API instead of SearXNG.** Search1API gives steadier results than engines reached from one server. Edit `omnilaya-secrets.env`: set `SEARCH_PROVIDER=search1api`, add `SEARCH1API_API_KEY=...`, and run `pnpm deploy:free ./omnilaya-secrets.env` again. It has 100 free credits, then paid plans.

**Try it before creating a server.** Run `laya-serve` on your own computer and open a temporary tunnel, which needs no account:

```bash
cloudflared tunnel --url http://localhost:8000
```

Use the printed `https://....trycloudflare.com` address as `LAYA_BASE_URL`. The address changes every time the tunnel restarts and your computer must stay on, so this is for testing only.

**Custom domain.** Add a `routes` entry in `wrangler.jsonc` (see the comment there), then run the deploy again.

## Updating

- New OmniLaya code: `pnpm deploy:free ./omnilaya-secrets.env`.
- New Laya version: change the version pin in `deploy/server/laya/Dockerfile`, copy the folder to the server again and rerun `setup.sh`. Keys are kept.

## Known limits of the free setup

- **Speed:** 5 to 15 seconds per search on 2 ARM cores.
- **Engines on SearXNG:** there is no X engine, so the X source reports that it cannot search. Reddit uses its site-restricted Google lane only. Google, DuckDuckGo and arXiv sometimes throttle a server (CAPTCHA or "too many requests"); SearXNG pauses that engine for a while and the other lanes still answer.
- **Cloudflare KV free plan:** 1,000 writes a day. After that the result cache stops storing new entries for the day; searches still work.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `setup.sh` waits and Laya never answers | Ports 80 and 443 open in the Oracle Security List; `sudo docker compose logs caddy laya` in `~/omnilaya-server` |
| Site says "Laya is temporarily unavailable" | `https://laya.<ip>.sslip.io/health` in a browser; `LAYA_BASE_URL` and `LAYA_API_KEY` match the server's `.env` |
| A source always shows a warning | That engine is throttled or has no SearXNG engine (X); see Known limits |
| `pnpm deploy:free` fails on the rate-limit binding | Remove the `ratelimits` block from `wrangler.jsonc` and run it again |
