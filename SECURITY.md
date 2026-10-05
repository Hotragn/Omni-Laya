# Security

Please report vulnerabilities privately through the repository's **Security → Report a vulnerability** page:

https://github.com/Hotragn/Omni-Laya/security/advisories/new

Include reproduction steps, affected files or endpoints, and the expected impact. Do not put credentials, private search queries or exploit details in public issues. If private reporting is unavailable, open an issue requesting a private contact without disclosing the vulnerability.

Provider credentials belong in ignored local `.dev.vars` files or Cloudflare Worker secrets. A `laya-serve` reachable from the internet has no authentication until you set `LAYA_API_KEY` on it; set one, and give the same value to OmniLaya as the `LAYA_API_KEY` secret. A public deployment incurs provider costs; use restricted keys, provider budgets and appropriate access controls for your deployment. The built-in per-IP rate limiter and origin check do not constitute authentication or a global budget limit.
