import type { DatabaseSync } from "node:sqlite";

export const SQLITE_BOUNDED_FILE_PAGE_SIZE = 65_536;

/** Caller owns page-count budgeting and writes; this primitive owns physical SQLite policy. */
export function configureSqliteBoundedFile(db: DatabaseSync, maxPageCount: number): void {
  db.exec(
    `PRAGMA page_size=${SQLITE_BOUNDED_FILE_PAGE_SIZE}; PRAGMA journal_mode=DELETE; PRAGMA cache_spill=OFF; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; PRAGMA max_page_count=${maxPageCount};`,
  );
}

/** Reject incompatible existing files without rewriting their layout. */
export function sqliteBoundedFileFits(db: DatabaseSync, maxPageCount: number): boolean {
  return (
    Number(db.prepare("PRAGMA page_size").get()?.page_size) === SQLITE_BOUNDED_FILE_PAGE_SIZE &&
    Number(db.prepare("PRAGMA page_count").get()?.page_count) <= maxPageCount
  );
}
