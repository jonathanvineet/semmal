# Arkiv friction log

What got in our way building Semmal on Rabdi with `@arkiv-network/sdk` 1.0.1, what we expected, what happened, and how
to reproduce it. Workarounds are linked to the code.

## 1. Write errors are replaced by a generic message
- **Expected:** when our signer/transport rejects a write (fee cap exceeded, wrong chain, user rejected), the error
  from `createEntity` says why.
- **Happened:** the SDK surfaced "Execution error without revert data" for errors raised inside our custom transport,
  hiding the real reason.
- **Repro:** wallet-mode client whose `send` throws `new Error("fee above cap")`; call `createEntity`; the caught
  error's message is generic.
- **Workaround:** we record the transport's own failure and show it
  ([`guarded-writer.ts`](../packages/arkiv-adapter/src/guarded-writer.ts), `lastFailure`).
- **Ask:** keep the original error as `cause`.

## 2. Injected wallets reject writes with 4100 unless accounts were requested first
- **Happened:** writing through a browser wallet that was connected earlier in the session failed with "The requested
  method and/or account has not been authorized" (4100).
- **Workaround:** call `eth_requestAccounts` right before every publish.
- **Ask:** have the wallet client do this, or document it in the React guide.

## 3. Wallets can't explain an Arkiv write, and MetaMask flags dapps that make them
- **Happened:** an entity create shows in MetaMask as "send 0 tGLM to 0x4400…0044" with a long zero-padded hex blob.
  Users can't see what they are signing. On a fresh `*.vercel.app` domain, MetaMask's Blockaid scan marks the whole
  site "DRAINER / BLOCK" (it does this for any unverified `vercel.app` name). Arkiv's raw calldata to an unknown
  address doesn't help.
- **Workaround:** our own approval card shows what is written, the network, gas and maximum fee before the wallet opens.
- **Ask:** a verified, decodable Arkiv contract on explorers and wallet security providers, or typed-data signing for
  writes, so wallets can show "create entity in schema X".

## 4. Selected columns come back wrapped
- **Expected:** `select({ task_score: true })` returns `100`.
- **Happened:** indexed values arrive as objects (`{ value: … }`, bigints for `u64`), printed as `[object Object]`.
- **Workaround:** a small `plain()` unwrapper ([`registry.ts`](../packages/arkiv-adapter/src/registry.ts),
  `scoredEpisodes`, `episodeRecord`).
- **Ask:** an option to get plain JS values, or a typed row type that says so.

## 5. Schema versions: we merge them by hand
- **Happened:** adding one indexed column (`task_score`) meant a new schema name (`semmal_episode_v2`); every reader
  now queries v1 and v2 and merges them.
- **Ask:** a documented migration pattern, or queries across a schema family.

## 6. No uniqueness, so "one live profile per robot" is ours to enforce
- **Happened:** profiles are versioned by re-publishing; anyone can also publish a profile claiming someone else's
  robot wallet.
- **Workaround:** readers keep the first owner of a robot wallet and that owner's newest `profile_version`
  (`listRobots` in [`registry.ts`](../packages/arkiv-adapter/src/registry.ts)).
- **Ask:** an optional unique indexed column per owner, or update-in-place guidance for profiles.

## 7. The access key is in the RPC URL
- **Happened:** `rabdi({ accessKey })` puts the key in the URL path, so it ends up in logs and can't go to the browser.
- **Workaround:** browser reads go through our allowlisted read-only proxy
  ([`arkiv-rpc-proxy.ts`](../apps/api/src/arkiv-rpc-proxy.ts)); the key stays server-side.
- **Ask:** header-based keys in the SDK (the HTTP docs already show `X-API-KEY`), and a browser-safe read key.

## 8. Lifetime ceiling
- Rabdi caps expiration at about 6 months, so evidence lives 120 days. Long-term audit trails need renewal jobs;
  built-in renewal would help.

## 9. Event history is live-tail only
- Documented: `eth_getLogs` fails for blocks older than about 1,000. We poll queries instead of watching events; a
  backfillable event API would let us build a live dashboard without polling.
