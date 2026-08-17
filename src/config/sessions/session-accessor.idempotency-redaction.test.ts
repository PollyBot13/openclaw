import path from "node:path";
import { expectDefined } from "@openclaw/normalization-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import {
  closeOpenClawAgentDatabasesForTest,
  openOpenClawAgentDatabase,
} from "../../state/openclaw-agent-db.js";
import {
  appendTranscriptMessage,
  appendTranscriptMessages,
  upsertSessionEntryCore,
} from "./session-accessor.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";

describe("SQLite transcript idempotency redaction", () => {
  const tempDirs: string[] = [];
  let storePath: string;

  beforeEach(() => {
    storePath = path.join(
      makeTempDir(tempDirs, "openclaw-idempotency-redaction-"),
      "sessions.json",
    );
  });

  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    cleanupTempDirs(tempDirs);
  });

  it.each([
    {
      idempotencyKey: "7c311c86-7836-4f47-bffc-aa8c3cbf261e:user",
      name: "credential-like UUID",
    },
    {
      idempotencyKey: "sk-abcdef1234567890xyz:user",
      name: "caller-supplied secret",
    },
  ])("keeps $name identity outside redacted event JSON", async ({ idempotencyKey }) => {
    const scope = {
      agentId: "main",
      sessionId: "session-redacted-replay",
      sessionKey: "agent:main:redacted-replay",
      storePath,
    };
    await upsertSessionEntryCore(scope, { sessionId: scope.sessionId, updatedAt: 10 });
    const message = {
      role: "user",
      content: "same secret sk-abcdef1234567890xyz",
      idempotencyKey,
      timestamp: 1,
    };
    const first = await appendTranscriptMessage(scope, {
      idempotencyLookup: "scan",
      message,
    });
    const replay = await appendTranscriptMessage(scope, {
      idempotencyLookup: "scan",
      message,
    });
    const databasePath = expectDefined(
      resolveSqliteTargetFromSessionStorePath(storePath, { agentId: "main" }).path,
      "idempotency redaction database path",
    );
    const database = openOpenClawAgentDatabase({ agentId: "main", path: databasePath });
    const stored = database.db
      .prepare(
        `SELECT identity.message_idempotency_key AS idempotencyKey,
                event.event_json AS eventJson
           FROM transcript_event_identities AS identity
           JOIN transcript_events AS event
             ON event.session_id = identity.session_id AND event.seq = identity.seq
          WHERE identity.session_id = ? AND identity.event_id = ?`,
      )
      .get(scope.sessionId, first.messageId) as
      | { eventJson: string; idempotencyKey: string }
      | undefined;

    expect(first.appended).toBe(true);
    expect(JSON.stringify(first.message)).not.toContain(idempotencyKey);
    expect(JSON.stringify(first.message)).not.toContain("sk-abcdef1234567890xyz");
    expect(stored).toMatchObject({ idempotencyKey });
    expect(stored?.eventJson).not.toContain(idempotencyKey);
    expect(replay).toMatchObject({ appended: false, messageId: first.messageId });
  });

  it("replays a redacted assistant message through its raw identity index", async () => {
    const scope = {
      agentId: "main",
      sessionId: "session-redacted-assistant-replay",
      sessionKey: "agent:main:redacted-assistant-replay",
      storePath,
    };
    const idempotencyKey = "sk-abcdef1234567890xyz:assistant";
    await upsertSessionEntryCore(scope, { sessionId: scope.sessionId, updatedAt: 10 });
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "same secret sk-abcdef1234567890xyz" }],
      idempotencyKey,
      timestamp: 1,
    };

    const first = await appendTranscriptMessage(scope, {
      idempotencyLookup: "scan-assistant",
      message,
    });
    const replay = await appendTranscriptMessage(scope, {
      idempotencyLookup: "scan-assistant",
      message,
    });
    const databasePath = expectDefined(
      resolveSqliteTargetFromSessionStorePath(storePath, { agentId: "main" }).path,
      "assistant idempotency redaction database path",
    );
    const database = openOpenClawAgentDatabase({ agentId: "main", path: databasePath });
    const stored = database.db
      .prepare(
        `SELECT identity.message_idempotency_key AS idempotencyKey,
                event.event_json AS eventJson
           FROM transcript_event_identities AS identity
           JOIN transcript_events AS event
             ON event.session_id = identity.session_id AND event.seq = identity.seq
          WHERE identity.session_id = ? AND identity.event_id = ?`,
      )
      .get(scope.sessionId, first.messageId) as
      | { eventJson: string; idempotencyKey: string }
      | undefined;

    expect(first.appended).toBe(true);
    expect(replay).toMatchObject({ appended: false, messageId: first.messageId });
    expect(JSON.stringify(first.message)).not.toContain(idempotencyKey);
    expect(stored).toMatchObject({ idempotencyKey });
    expect(stored?.eventJson).not.toContain(idempotencyKey);
  });

  it("preserves raw replay identity across a pre-redacted atomic batch", async () => {
    const scope = {
      agentId: "main",
      sessionId: "session-redacted-batch-replay",
      sessionKey: "agent:main:redacted-batch-replay",
      storePath,
    };
    const idempotencyKey = "sk-abcdef1234567890xyz:batch";
    await upsertSessionEntryCore(scope, { sessionId: scope.sessionId, updatedAt: 10 });
    const message = {
      role: "user",
      content: "same secret sk-abcdef1234567890xyz",
      idempotencyKey,
      timestamp: 1,
    };

    const [first] = await appendTranscriptMessages(scope, {
      messages: [{ idempotencyLookup: "scan", message }],
    });
    const [replay] = await appendTranscriptMessages(scope, {
      messages: [{ idempotencyLookup: "scan", message }],
    });
    const databasePath = expectDefined(
      resolveSqliteTargetFromSessionStorePath(storePath, { agentId: "main" }).path,
      "batch idempotency redaction database path",
    );
    const database = openOpenClawAgentDatabase({ agentId: "main", path: databasePath });
    const stored = database.db
      .prepare(
        `SELECT identity.message_idempotency_key AS idempotencyKey,
                event.event_json AS eventJson
           FROM transcript_event_identities AS identity
           JOIN transcript_events AS event
             ON event.session_id = identity.session_id AND event.seq = identity.seq
          WHERE identity.session_id = ? AND identity.event_id = ?`,
      )
      .get(scope.sessionId, expectDefined(first?.messageId, "batch first message id")) as
      | { eventJson: string; idempotencyKey: string }
      | undefined;

    expect(first).toMatchObject({ appended: true });
    expect(replay).toMatchObject({ appended: false, messageId: first?.messageId });
    expect(stored).toMatchObject({ idempotencyKey });
    expect(stored?.eventJson).not.toContain(idempotencyKey);
    expect(stored?.eventJson).not.toContain("sk-abcdef1234567890xyz");
  });
});
