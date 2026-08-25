import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { PrismaClient } from "@prisma/client";
import { AdapterRegistry } from "./adapters/adapterRegistry.js";
import { CommentRepository } from "./repositories/commentRepository.js";
import { PostRepository } from "./repositories/postRepository.js";
import { SocialAccountRepository } from "./repositories/socialAccountRepository.js";
import { CommentService } from "./services/commentService.js";
import { commentRoutes } from "./routes/comments.js";
import {
  NotFoundError,
  PlatformApiError,
  UnsupportedPlatformError,
} from "./errors.js";

export interface BuildAppOptions {
  prisma?: PrismaClient;
  commentCacheTtlSeconds?: number;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const fastify = Fastify({ logger: options.logger ?? true }).withTypeProvider<TypeBoxTypeProvider>();

  const prisma = options.prisma ?? new PrismaClient();
  const commentRepo = new CommentRepository(prisma);
  const postRepo = new PostRepository(prisma);
  const socialAccountRepo = new SocialAccountRepository(prisma);
  const adapters = new AdapterRegistry();
  const commentService = new CommentService(
    commentRepo,
    postRepo,
    socialAccountRepo,
    adapters,
    options.commentCacheTtlSeconds ?? 300,
  );

  fastify.register(commentRoutes, { prefix: "/api", commentService });

  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      reply.code(400).send({ error: "BadRequest", message: error.message });
      return;
    }
    if (error instanceof NotFoundError) {
      reply.code(404).send({ error: "NotFound", message: error.message });
      return;
    }
    if (error instanceof UnsupportedPlatformError) {
      reply.code(400).send({ error: "UnsupportedPlatform", message: error.message });
      return;
    }
    if (error instanceof PlatformApiError) {
      fastify.log.error({ err: error.cause, platform: error.platform }, error.message);
      reply.code(502).send({ error: "PlatformApiError", message: error.message });
      return;
    }

    fastify.log.error(error);
    reply.code(500).send({ error: "InternalServerError", message: "Something went wrong" });
  });

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return fastify;
}
