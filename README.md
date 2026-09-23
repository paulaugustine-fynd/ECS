# ATI External Concessions demonstration

The current application is in `public/`. Start the dependency-free local demo with:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory public
```

Open `http://127.0.0.1:4173/index.html`. Application, partner workspace and ATI console are separate routes sharing browser-local demo records. Integrations are explicitly simulated. Do not use real customer or compliance data.

- [Current presenter walkthrough](DEMO_WALKTHROUGH.md)
- [All 54 requirements: evidence and remaining work](REQUIREMENTS_COVERAGE.md)
- [Implementation plan](IMPLEMENTATION_PLAN.md)
- [Proposed production pilot contracts](PILOT_CONTRACTS.md)

Tests: `npm test` / `node --test tests/domain.test.mjs`. The framework homepage embeds the same canonical launchpad. Old `core.js` and `demo.js` are retained legacy assets and are not loaded by the active pages.

## Deploy this demo on Vercel

Import `paulaugustine-fynd/ECS` in Vercel with the repository root as the Root Directory. The checked-in `vercel.json` selects **Other**, skips dependency installation, runs the domain tests and serves **public** as the output directory. Do not select Next.js or run the Cloudflare/vinext scaffold build for this static demo. This follows [Vercel's build configuration guidance](https://vercel.com/docs/builds/configure-a-build).

**Required environment variables: none.** The current demo uses fictional browser-local records and simulated integrations. Never upload `.env.local`, credentials, `node_modules`, `.git`, local uploads or generated build directories. Keep `package-lock.json` with the existing npm project; do not introduce an unrelated pnpm lockfile.

Git integration can deploy future commits after the GitHub repository is connected to the Vercel project. The first successful deployment and branch connection still need to be verified in the dashboard. The configuration alone does not establish either.

The repository and deployment may be publicly accessible. Review customer-specific documentation before publishing. `X-Robots-Tag: noindex, nofollow` discourages search indexing but is not access control. Use Vercel deployment protection for a restricted customer demo, if available on your plan.

---

## Framework scaffold reference

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: run the concession domain acceptance tests
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
