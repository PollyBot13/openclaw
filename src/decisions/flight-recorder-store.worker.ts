import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Generated } from "kysely";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import {
  configureSqliteBoundedFile,
  SQLITE_BOUNDED_FILE_PAGE_SIZE as PAGE_SIZE,
  sqliteBoundedFileFits,
} from "../infra/sqlite-bounded-file.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion, writeSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { bindSqliteWorkerDatabase } from "../infra/sqlite-worker-binding.js";
import type { DecisionRecording, RecorderStoreOperations } from "./flight-recorder.types.js";

const EXPORT_LIMIT = 8 * 1024 * 1024;
const SCHEMA =
  "CREATE TABLE records (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL); CREATE TABLE budget (id INTEGER PRIMARY KEY CHECK(id=1), max_bytes INTEGER NOT NULL);";
type Schema = {
  records: { seq: Generated<number>; id: string; record_json: string };
  budget: { id: number; max_bytes: number };
};
/** Database + one original rollback image per page + SQLite's maximum sector header. */
export function recorderPageLimit(maxBytes: number) {
  return Math.floor((maxBytes - PAGE_SIZE) / (2 * PAGE_SIZE + 8));
}
const full = (error: unknown) =>
  error instanceof Error && /database or disk is full/i.test(error.message);
function serialize(record: DecisionRecording, maxBytes: number) {
  const limit = Math.min(EXPORT_LIMIT - 1024, ((recorderPageLimit(maxBytes) - 5) * PAGE_SIZE) / 2);
  let json = JSON.stringify(record);
  if (Buffer.byteLength(json) > limit && record.input.batch) {
    json = JSON.stringify({ ...record, input: { completeness: "oversize" } });
  }
  return Buffer.byteLength(json) > limit ? undefined : json;
}
export function createSqliteWorkerBackend(
  input: { maxBytes: number; sourcePath?: string },
  { databasePath }: { databasePath: string },
) {
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(databasePath), 0o700);
  // A failed pre-swap resize left only an unaccepted candidate; never resume it.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${databasePath}.next${suffix}`, { force: true });
  }
  const db = openNodeSqliteDatabase(databasePath);
  chmodSync(databasePath, 0o600);
  const query = getNodeSqliteKysely<Schema>(db);
  let maxBytes = input.maxBytes;
  const physicalBytes = () =>
    [
      databasePath,
      `${databasePath}-journal`,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
      `${databasePath}.next`,
      `${databasePath}.next-journal`,
    ].reduce((sum, file) => sum + (existsSync(file) ? statSync(file).size : 0), 0);
  try {
    const version = readSqliteUserVersion(db);
    if (version !== 0 && version !== 1) {
      throw new Error("Recorder pool version is unsupported.");
    }
    if (version === 1) {
      maxBytes = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom("budget").select("max_bytes").where("id", "=", 1),
      )!.max_bytes;
    }
    if (recorderPageLimit(maxBytes) < 7 || physicalBytes() > maxBytes) {
      throw new Error("Recorder pool exceeds its budget.");
    }
    configureSqliteBoundedFile(db, recorderPageLimit(maxBytes));
    if (!sqliteBoundedFileFits(db, recorderPageLimit(maxBytes))) {
      throw new Error("Recorder pool layout is incompatible with its budget.");
    }
    if (version === 0) {
      let rows: { seq: number; id: string; record_json: string }[] = [];
      if (input.sourcePath) {
        // The original owner has validated this pool and holds its queue while
        // the separately admitted replacement actor reads it without mutations.
        const source = openNodeSqliteDatabase(input.sourcePath, { readOnly: true });
        const sourceQuery = getNodeSqliteKysely<Schema>(source);
        try {
          rows = [];
          let cursor = Number.MAX_SAFE_INTEGER;
          let bytes = 0;
          while (bytes < maxBytes / 2) {
            const page = executeSqliteQuerySync(
              source,
              sourceQuery
                .selectFrom("records")
                .selectAll()
                .where("seq", "<", cursor)
                .orderBy("seq", "desc")
                .limit(32),
            ).rows;
            if (!page.length) {
              break;
            }
            for (const row of page) {
              const json = row.record_json;
              if (Buffer.byteLength(json) <= (recorderPageLimit(maxBytes) - 4) * PAGE_SIZE) {
                rows.push({ seq: row.seq, id: row.id, record_json: json });
                bytes += Buffer.byteLength(json);
              }
              cursor = row.seq;
              if (bytes >= maxBytes / 2) {
                break;
              }
            }
          }
        } finally {
          source.close();
        }
      }
      for (;;) {
        let inserted = 0;
        try {
          // Initial creation has no old pages to journal. This permits a bounded
          // replacement beside the old pool even for a near-equal budget shrink.
          runSqliteImmediateTransactionSync(db, () => {
            // sqlite-allow-raw: first-use DDL for this private versioned pool, not data queries.
            db.exec(SCHEMA);
            writeSqliteUserVersion(db, 1);
            executeSqliteQuerySync(
              db,
              query.insertInto("budget").values({ id: 1, max_bytes: maxBytes }),
            );
            for (const row of rows) {
              executeSqliteQuerySync(db, query.insertInto("records").values(row));
              inserted++;
            }
          });
          break;
        } catch (error) {
          if (!full(error) || rows.length === 0) {
            throw error;
          }
          // Retry only the newest prefix proven to fit before SQLITE_FULL.
          rows.length = inserted;
        }
      }
    }
    assertSqliteIntegrity(db, "Recorder pool", { check: "quick" });
  } catch (error) {
    db.close();
    throw error;
  }
  return bindSqliteWorkerDatabase<RecorderStoreOperations>(db, {
    execute(command) {
      if (command.type === "resize") {
        const targetBytes = command.input.maxBytes;
        if (targetBytes === maxBytes) {
          return {};
        }
        if (targetBytes > maxBytes) {
          configureSqliteBoundedFile(db, recorderPageLimit(targetBytes));
          runSqliteImmediateTransactionSync(db, () =>
            executeSqliteQuerySync(
              db,
              query.updateTable("budget").set({ max_bytes: targetBytes }).where("id", "=", 1),
            ),
          );
          maxBytes = targetBytes;
          return {};
        }
        return { replace: true };
      }
      if (command.type === "append") {
        const json = serialize(command.input, maxBytes);
        if (!json) {
          return { retained: false, evicted: 0 };
        }
        let evicted = 0;
        for (;;) {
          try {
            runSqliteImmediateTransactionSync(db, () =>
              executeSqliteQuerySync(
                db,
                query.insertInto("records").values({ id: command.input.id, record_json: json }),
              ),
            );
            return { retained: true, evicted };
          } catch (error) {
            if (!full(error)) {
              throw error;
            }
            const oldest = executeSqliteQueryTakeFirstSync(
              db,
              query.selectFrom("records").select("seq").orderBy("seq").limit(1),
            );
            if (!oldest) {
              return { retained: false, evicted };
            }
            runSqliteImmediateTransactionSync(db, () =>
              executeSqliteQuerySync(db, query.deleteFrom("records").where("seq", "=", oldest.seq)),
            );
            evicted++;
          }
        }
      }
      if (command.type === "list") {
        const rows = executeSqliteQuerySync(
          db,
          query
            .selectFrom("records")
            .selectAll()
            .where("seq", "<", command.input.cursor ?? Number.MAX_SAFE_INTEGER)
            .orderBy("seq", "desc")
            .limit(command.input.limit + 1),
        ).rows;
        const records = rows.slice(0, command.input.limit).map(({ record_json }) => {
          // SAFETY: this private versioned pool stores only serialized DecisionRecording values.
          const recording = JSON.parse(record_json) as DecisionRecording;
          const { outcome: _outcome, input: recordedInput, ...metadata } = recording;
          return Object.assign(metadata, {
            input: { completeness: recordedInput.completeness },
            bytes: Buffer.byteLength(record_json),
          });
        });
        const recordCount = Number(
          executeSqliteQueryTakeFirstSync(
            db,
            query.selectFrom("records").select((eb) => eb.fn.countAll().as("count")),
          )?.count ?? 0,
        );
        return {
          records,
          recordCount,
          storageBytes: physicalBytes(),
          maxBytes,
          ...(rows.length > command.input.limit
            ? { nextCursor: rows[command.input.limit - 1]!.seq }
            : {}),
        };
      }
      const { ids, format, preview } = command.input;
      const selectedBytes = executeSqliteQuerySync(
        db,
        query
          .selectFrom("records")
          .select((eb) => eb.fn<number>("length", [eb.cast("record_json", "blob")]).as("bytes"))
          .where("id", "in", ids),
      ).rows;
      if (selectedBytes.reduce((sum, row) => sum + row.bytes + 1, 2) > EXPORT_LIMIT) {
        throw new Error("Export exceeds 8 MiB; select fewer records.");
      }
      const rows = executeSqliteQuerySync(
        db,
        query.selectFrom("records").select("record_json").where("id", "in", ids).orderBy("seq"),
      ).rows;
      if (rows.length !== new Set(ids).size) {
        throw new Error("Selected records were evicted or deleted; refresh the list.");
      }
      const content =
        format === "json"
          ? `[${rows.map((row) => row.record_json).join(",")}]`
          : rows.map((row) => row.record_json).join("\n") + (rows.length ? "\n" : "");
      const bytes = Buffer.byteLength(content);
      // Bound the escaped RPC string as well as the downloaded file bytes.
      if (
        bytes > EXPORT_LIMIT ||
        Buffer.byteLength(JSON.stringify({ content })) + 1024 > EXPORT_LIMIT
      ) {
        throw new Error("Export exceeds 8 MiB; select fewer records.");
      }
      return {
        formatVersion: 1 as const,
        recordCount: rows.length,
        format,
        bytes,
        ...(preview ? {} : { content }),
      };
    },
    close() {
      db.close();
    },
  });
}
export const openExistingSqliteWorkerBackend = createSqliteWorkerBackend;
