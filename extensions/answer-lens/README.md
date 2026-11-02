# Answer Lens

Read an existing answer at a different length or technical depth, in a separate
OpenClaw session sidebar. The original answer and conversation history stay unchanged.

Open **Answer Lens** in a conversation header. Choose an answer, select **Gist**,
**Shorter**, or **Full**, and choose **Simple**, **Clearer**, **Technical**, or
**Original wording**. Click **Adjust explanation** to generate a reading.
**Original** restores the source immediately. **Refresh answers** loads recent answers.

## Install the built artifact

```sh
openclaw plugins install ./answer-lens-0.1.0.tgz
openclaw plugins enable answer-lens
```

Native plugin UI runs trusted JavaScript inside the Control UI. Use a Control UI
served by the same Gateway over HTTPS or trusted loopback. OpenClaw owns plugin
loading, access controls, native panels, and model credentials.

This experimental SDK integration was tested against OpenClaw main at
`d6510f3c7`. It requires the native panel/openPanel, authenticated Gateway dispatch,
retained session access, and isolated LLM completion APIs in that revision.

## Behavior and limits

- Inference runs only after an explicit click, through the **default agent's
  configured isolated runtime**, not necessarily the agent owning the source.
  No new credential, model override, fallback provider, or chat session is created.
- There is no transcript replacement, automatic rewrite, streaming, persistent
  preference, channel delivery, or agent tool registration.
- Rewrites require write access to the source conversation. Incognito transforms
  are not supported. Source reads use the signed-in caller's history access.
- The source must be a completed assistant answer with a persisted identity, at
  most 32,000 characters. Commentary, thinking/tool-only output, and truncated
  answers are excluded. The picker covers the recent history window.
- Each rewrite uses the original source, never another rewrite. Source revision
  and session identity are checked before and after inference. Revoked access,
  changed sources, disconnects, and obsolete UI requests cannot publish a result.
- Requests have a 25-second deadline, within the host UI's 30-second RPC limit.
  Slow model calls fail visibly; retry explicitly. Restoring Original or changing
  settings discards pending presentation, but does not claim to cancel the model.
- The plugin supplies no tools. The SDK's isolated-runtime contract notes that
  Agents API runtimes can retain service-owned helpers; it does not guarantee
  universal zero-tool execution for that runtime.
- Rendered Markdown is sanitized, with no embedded images, scripts, or remote
  resource loading. Reading variants are view-local and disappear when disposed.

## Source-checkout development

This directory is a self-contained plugin; its only host imports are public
`openclaw/plugin-sdk/*` modules. Development is staged under `extensions/` to use
the repository's pinned tooling. No core source changes are required.

From the OpenClaw checkout root:

```sh
pnpm install --frozen-lockfile
node --import ./scripts/tsx.mjs scripts/build-plugin-control-ui.mts extensions/answer-lens
pnpm test:extension answer-lens
node extensions/answer-lens/scripts/package.mjs /path/to/new-package-directory
cd /path/to/new-package-directory
npm pack
```

The standard package bundles its backend and browser dependencies and declares
no install scripts or runtime dependencies. The normal plugin installer accepts
its `.tgz`; the tool/feature-only artifact-approval packer is not used. A registry release is separate
from building or locally installing this artifact.
