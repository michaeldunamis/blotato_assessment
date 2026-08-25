/**
 * Opaque keyset-pagination cursor over (publishedAt, id). Keyset rather
 * than offset because comment lists are appended to over time (new
 * syncs/replies) and offset pagination would skip or repeat rows as that
 * happens between page requests.
 */
export interface CursorKey {
  publishedAt: Date;
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  const raw = `${key.publishedAt.toISOString()}|${key.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorKey {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const [publishedAtRaw, id] = raw.split("|");
  if (!publishedAtRaw || !id) {
    throw new Error("Malformed cursor");
  }
  const publishedAt = new Date(publishedAtRaw);
  if (Number.isNaN(publishedAt.getTime())) {
    throw new Error("Malformed cursor");
  }
  return { publishedAt, id };
}
