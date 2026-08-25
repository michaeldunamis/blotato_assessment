import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { CommentService } from "../services/commentService.js";
import { toCommentDTO } from "./dto.js";

const CommentSchema = Type.Object({
  id: Type.String(),
  platform: Type.String(),
  postId: Type.String(),
  parentId: Type.Union([Type.String(), Type.Null()]),
  authorName: Type.String(),
  authorAvatarUrl: Type.Union([Type.String(), Type.Null()]),
  text: Type.String(),
  likeCount: Type.Integer(),
  publishedAt: Type.String(),
  replyCount: Type.Optional(Type.Integer()),
});

const PageSchema = Type.Object({
  items: Type.Array(CommentSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const PageQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const DEFAULT_PAGE_SIZE = 20;

const IdempotencyHeaderSchema = Type.Object(
  { "idempotency-key": Type.Optional(Type.String()) },
  { additionalProperties: true },
);

export interface CommentRoutesOptions {
  commentService: CommentService;
}

export const commentRoutes: FastifyPluginAsyncTypebox<CommentRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { commentService } = opts;

  fastify.get(
    "/posts/:postId/comments",
    {
      schema: {
        params: Type.Object({ postId: Type.String() }),
        querystring: Type.Intersect([
          PageQuerySchema,
          Type.Object({ sync: Type.Optional(Type.Boolean()) }),
        ]),
        response: { 200: PageSchema },
      },
    },
    async (request) => {
      const { postId } = request.params;
      const { cursor, limit, sync } = request.query;
      const page = await commentService.listTopLevelComments(postId, {
        cursor: cursor ?? null,
        limit: limit ?? DEFAULT_PAGE_SIZE,
        forceSync: sync ?? false,
      });
      return { items: page.items.map(toCommentDTO), nextCursor: page.nextCursor };
    },
  );

  fastify.get(
    "/comments/:commentId/replies",
    {
      schema: {
        params: Type.Object({ commentId: Type.String() }),
        querystring: PageQuerySchema,
        response: { 200: PageSchema },
      },
    },
    async (request) => {
      const { commentId } = request.params;
      const { cursor, limit } = request.query;
      const page = await commentService.listReplies(commentId, {
        cursor: cursor ?? null,
        limit: limit ?? DEFAULT_PAGE_SIZE,
      });
      return { items: page.items.map(toCommentDTO), nextCursor: page.nextCursor };
    },
  );

  fastify.post(
    "/comments/:commentId/replies",
    {
      schema: {
        params: Type.Object({ commentId: Type.String() }),
        body: Type.Object({ text: Type.String({ minLength: 1, maxLength: 2000 }) }),
        headers: IdempotencyHeaderSchema,
        response: { 201: CommentSchema },
      },
    },
    async (request, reply) => {
      const { commentId } = request.params;
      const { text } = request.body;
      const idempotencyKey = request.headers["idempotency-key"];
      const created = await commentService.replyToComment(commentId, text, idempotencyKey);
      reply.code(201);
      return toCommentDTO(created);
    },
  );
};
