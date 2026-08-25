import closeWithGrace from "close-with-grace";
import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp({ commentCacheTtlSeconds: config.commentCacheTtlSeconds });

closeWithGrace(async ({ err }) => {
  if (err) app.log.error(err);
  await app.close();
});

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
