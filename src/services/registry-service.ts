import type { RunResult } from "better-sqlite3";
import type { RegistryDatabase } from "../db";
import type {
  PublishResult,
  RegistryMetadata,
  RegistryOfficialMetadata,
  ServerDetail,
  ServerList,
  ServerResponse,
} from "../types/registry";
import { HttpError, NotFoundError } from "../utils/errors";

interface ServerVersionRow {
  id: number;
  server_name: string;
  description: string;
  title: string | null;
  version: string;
  server_json: string;
  meta_json: string;
  published_at: string;
  updated_at: string;
  is_latest: number;
  search_text: string;
}

export interface ListServersOptions {
  limit?: number;
  cursor?: string;
  search?: string;
  updatedSince?: string;
  version?: string;
}

export class RegistryService {
  constructor(private readonly db: RegistryDatabase) {}

  publish(serverDetail: ServerDetail): PublishResult {
    const transaction = this.db.transaction((detail: ServerDetail) => this.publishInternal(detail));
    return transaction(serverDetail);
  }

  listServers(options: ListServersOptions = {}): ServerList {
    const limit = this.resolveLimit(options.limit);
    const cursorId = options.cursor ? this.decodeCursor(options.cursor) : undefined;

    const conditions: string[] = [];
    const parameters: unknown[] = [];

    if (!options.version || options.version === "latest") {
      conditions.push("is_latest = 1");
    } else {
      conditions.push("version = ?");
      parameters.push(options.version);
    }

    if (typeof cursorId === "number") {
      conditions.push("id > ?");
      parameters.push(cursorId);
    }

    if (options.search) {
      conditions.push("search_text LIKE ?");
      parameters.push(`%${options.search.toLowerCase()}%`);
    }

    if (options.updatedSince) {
      const iso = this.ensureIsoDate(options.updatedSince);
      conditions.push("updated_at >= ?");
      parameters.push(iso);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `SELECT * FROM server_versions ${whereClause} ORDER BY id ASC LIMIT ?`;
    const rows = this.db.prepare<unknown[]>(query).all(...parameters, limit) as ServerVersionRow[];

    const servers = rows.map((row) => this.mapRowToResponse(row));
    const nextCursor = rows.length === limit ? this.encodeCursor(rows[rows.length - 1].id) : undefined;

    const metadata: { count: number; nextCursor?: string } = {
      count: rows.length,
    };
    if (nextCursor) {
      metadata.nextCursor = nextCursor;
    }

    return {
      servers,
      metadata,
    };
  }

  listServerVersions(serverName: string): ServerList {
    const decodedName = decodeURIComponent(serverName);
    const rows = this.db
      .prepare<[string]>(
        `
        SELECT * FROM server_versions
        WHERE server_name = ?
        ORDER BY published_at DESC, version DESC
      `,
      )
      .all(decodedName) as ServerVersionRow[];

    if (rows.length === 0) {
      throw new NotFoundError("Server not found");
    }

    const servers = rows.map((row) => this.mapRowToResponse(row));

    return {
      servers,
      metadata: {
        count: rows.length,
      },
    };
  }

  getServerVersion(serverName: string, versionParam: string): ServerResponse {
    const decodedName = decodeURIComponent(serverName);
    const decodedVersion = decodeURIComponent(versionParam);

    let row: ServerVersionRow | undefined;
    if (decodedVersion === "latest") {
      row = this.db
        .prepare<[string]>(`SELECT * FROM server_versions WHERE server_name = ? AND is_latest = 1 LIMIT 1`)
        .get(decodedName) as ServerVersionRow | undefined;
    } else {
      row = this.db
        .prepare<[string, string]>(
          `SELECT * FROM server_versions WHERE server_name = ? AND version = ? LIMIT 1`,
        )
        .get(decodedName, decodedVersion) as ServerVersionRow | undefined;
    }

    if (!row) {
      throw new NotFoundError("Server version not found");
    }

    return this.mapRowToResponse(row);
  }

  private publishInternal(serverDetail: ServerDetail): PublishResult {
    const now = new Date().toISOString();
    const searchText = this.computeSearchText(serverDetail);

    const existingRow = this.db
      .prepare<[string, string]>(
        `SELECT * FROM server_versions WHERE server_name = ? AND version = ? LIMIT 1`,
      )
      .get(serverDetail.name, serverDetail.version) as ServerVersionRow | undefined;

    if (existingRow) {
      const metadata = this.hydrateMetadata(existingRow.meta_json, existingRow.published_at, now, existingRow.is_latest === 1);
      const updated = this.db
        .prepare(
          `
          UPDATE server_versions
          SET
            description = ?,
            title = ?,
            server_json = ?,
            meta_json = ?,
            updated_at = ?,
            search_text = ?
          WHERE id = ?
        `,
        )
        .run(
          serverDetail.description,
          serverDetail.title ?? null,
          JSON.stringify(serverDetail),
          JSON.stringify(metadata),
          now,
          searchText,
          existingRow.id,
        );

      this.assertChanges(updated, "Failed to update existing server version");

      return {
        response: {
          server: serverDetail,
          _meta: metadata,
        },
        created: false,
      };
    }

    this.demoteExistingLatest(serverDetail.name, now);

    const metadata = this.hydrateMetadata(undefined, now, now, true);
    const insertResult = this.db
      .prepare(
        `
        INSERT INTO server_versions (
          server_name,
          description,
          title,
          version,
          server_json,
          meta_json,
          published_at,
          updated_at,
          is_latest,
          search_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
      )
      .run(
        serverDetail.name,
        serverDetail.description,
        serverDetail.title ?? null,
        serverDetail.version,
        JSON.stringify(serverDetail),
        JSON.stringify(metadata),
        now,
        now,
        searchText,
      );

    this.assertChanges(insertResult, "Failed to insert server version");

    return {
      response: {
        server: serverDetail,
        _meta: metadata,
      },
      created: true,
    };
  }

  private demoteExistingLatest(serverName: string, timestamp: string): void {
    const rows = this.db
      .prepare<[string]>(`SELECT id, meta_json, published_at FROM server_versions WHERE server_name = ? AND is_latest = 1`)
      .all(serverName) as Array<Pick<ServerVersionRow, "id" | "meta_json" | "published_at">>;

    const updateStatement = this.db.prepare<[string, string, number]>(
      `
      UPDATE server_versions
      SET meta_json = ?, updated_at = ?, is_latest = 0
      WHERE id = ?
    `,
    );

    for (const row of rows) {
      const metadata = this.hydrateMetadata(row.meta_json, row.published_at, timestamp, false);
      updateStatement.run(JSON.stringify(metadata), timestamp, row.id);
    }
  }

  private hydrateMetadata(
    rawMeta: string | undefined,
    publishedAtFallback: string,
    updatedAt: string,
    isLatest: boolean,
  ): RegistryMetadata {
    const metadata: RegistryMetadata = rawMeta ? (JSON.parse(rawMeta) as RegistryMetadata) : {};
    const officialKey = "io.modelcontextprotocol.registry/official" as const;
    const official: RegistryOfficialMetadata = {
      status: metadata[officialKey]?.status ?? "active",
      publishedAt: metadata[officialKey]?.publishedAt ?? publishedAtFallback,
      updatedAt,
      isLatest,
    };
    metadata[officialKey] = official;
    return metadata;
  }

  private mapRowToResponse(row: ServerVersionRow): ServerResponse {
    const server = JSON.parse(row.server_json) as ServerDetail;
    const metadata = JSON.parse(row.meta_json) as RegistryMetadata;
    return {
      server,
      _meta: metadata,
    };
  }

  private computeSearchText(detail: ServerDetail): string {
    const tokens = [detail.name, detail.description, detail.title ?? ""]
      .map((token) => token?.toString().toLowerCase() ?? "")
      .filter(Boolean);
    return tokens.join(" ");
  }

  private encodeCursor(id: number): string {
    return Buffer.from(id.toString(), "utf8").toString("base64url");
  }

  private decodeCursor(cursor: string): number {
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const id = Number.parseInt(decoded, 10);
      if (Number.isNaN(id) || id < 0) {
        throw new Error("Invalid cursor numeric value");
      }
      return id;
    } catch (error) {
      throw new HttpError(400, "Invalid cursor parameter");
    }
  }

  private ensureIsoDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      throw new HttpError(400, "updated_since must be a valid ISO-8601 timestamp");
    }
    return date.toISOString();
  }

  private resolveLimit(limit?: number): number {
    if (limit === undefined || limit === null) {
      return 30;
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new HttpError(400, "limit must be a positive integer");
    }
    return Math.min(limit, 100);
  }

  private assertChanges(result: RunResult, errorMessage: string): void {
    if (result.changes === 0) {
      throw new Error(errorMessage);
    }
  }
}

