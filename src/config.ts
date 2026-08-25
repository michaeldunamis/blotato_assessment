import "dotenv/config";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export const config = {
  port: Number(requireEnv("PORT", "3000")),
  databaseUrl: requireEnv("DATABASE_URL"),
  commentCacheTtlSeconds: Number(requireEnv("COMMENT_CACHE_TTL_SECONDS", "300")),
};
