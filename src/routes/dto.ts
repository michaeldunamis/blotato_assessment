import type { Comment } from "@prisma/client";
import type { CommentWithReplyCount } from "../repositories/commentRepository.js";

export interface CommentDTO {
  id: string;
  platform: string;
  postId: string;
  parentId: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: string;
  replyCount?: number;
}

export function toCommentDTO(comment: Comment | CommentWithReplyCount): CommentDTO {
  return {
    id: comment.id,
    platform: comment.platform,
    postId: comment.postId,
    parentId: comment.parentId,
    authorName: comment.authorName,
    authorAvatarUrl: comment.authorAvatarUrl,
    text: comment.text,
    likeCount: comment.likeCount,
    publishedAt: comment.publishedAt.toISOString(),
    ...("replyCount" in comment ? { replyCount: comment.replyCount } : {}),
  };
}
