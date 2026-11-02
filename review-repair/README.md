# Answer Lens authority-chain proof

Executed against the source Gateway on Node 24.22.2 with isolated synthetic state. No production Gateway, user transcripts, or real provider credentials were used. The registered RPC dispatcher, storage owners, authorization, utility preparation, isolated completion, HTTP adapter, broadcaster, and TLS WebSocket clients are real. Only the external model is a local HTTP SSE fixture; this is authority/delivery proof, not model-quality evidence.

## Result

| Scenario | Provider requests after revocation before dispatch | Socket deltas after revocation | Result |
| --- | ---: | ---: | --- |
| Incognito memory actor closes during utility preparation | 0 | 0 | RPC refused |
| Incognito memory actor closes with HTTP response held | Already dispatched: 1 | 0 | RPC refused |
| Durable read authority revoked to draft during utility preparation | 0 | 0 | RPC refused |
| Durable read authority revoked to draft with HTTP response held | Already dispatched: 1 | 0 | RPC refused |

Each scenario also sends a later request on the same still-connected operator connection: it is refused with zero additional provider requests. Successful incognito/local-owner and durable/profiled-operator controls each receive one requester delta, zero observer deltas, and leave transcript history unchanged.

**Red/green:** On the reviewed original handler, closing the private actor during the held HTTP response leaked one late socket delta even though the final RPC failed. With the retained actor guard, the same composition delivers no late delta. Source hashes are in `public-report.json`.

## Existing access policy, unchanged

- A local shared-token owner-equivalent CLI with only `operator.read` and `operator.write` receives its authorized incognito deltas through the existing broadcaster. No delivery-filter change is needed.
- An identified non-admin profile, including the source creator, is refused incognito access before model I/O. The proof verifies the refusal through TLS RPC. Granting that profile new incognito access would change existing policy.
- Removing membership alone does not revoke read access for the supported public `view` role. Original remains readable after membership removal; the proof then changes visibility to draft, which actually revokes read authority. The public role schema does not accept the internal prepared `invited` cap.

## Barriers and limitations

The pre-dispatch fixture uses Node's module wrapper to call and await the **real** `prepareUtilityCompletionForAgent`, then pauses its return. It does not replace completion behavior or any authority decision. The test closes/revokes through the real state owner, releases the barrier, and observes provider request count and actual client socket frames. The in-flight fixture holds the external HTTP response until after revocation. Neither scenario closes the requesting connection.

Repair commit: `08d302fc15df7b5c3c6f49b407054411d5a263f0`.

Copy `reproduce.ts` from this directory into the checkout at: `.qa-artifacts/answer-lens/authority-proof/run.ts`. Run each mode sequentially under Node 24:

```sh
node --experimental-test-module-mocks --import tsx .qa-artifacts/answer-lens/authority-proof/run.ts
PROOF_MODE=member node --experimental-test-module-mocks --import tsx .qa-artifacts/answer-lens/authority-proof/run.ts
```

The fixture uses temporary isolated state and a local TLS Gateway/SSE provider. Raw logs and state are not part of this public report. No semantic equivalence or live-provider performance claim is made.

## UI budget repair

Both controls now use existing labeled menus and chip styles. Total CSS is exactly the pre-feature baseline: 115 assets, 309603 gzip bytes, 1601627 raw bytes. Browser proof used the built Control UI, real isolated Gateway and real configured utility model, with synthetic heat-pump prose; desktop and 400px layouts, rewrite, Gist and Original reset were checked.

Before: `simple-wording-400.png`. After: `review-native-{desktop,mobile}-{menu,result}.png`. Earlier videos show the previous dot-selector styling, not these repaired menus.
