/**
 * Shared scaffolding for the in-memory stand-ins (`twitterClient`,
 * `instagramClient`). A real client would NOT extend this — it'd just
 * make HTTP calls and wouldn't need a store, a seed step, or an id counter.
 */
export abstract class RemoteClient<TComment extends { id: string }> {
  private readonly store = new Map<string, TComment[]>();
  private nextId: number;

  constructor(startingId: number) {
    this.nextId = startingId;
  }

  /** Platform-flavored seed data for a post the first time it's touched. */
  protected abstract seed(postId: string): TComment[];

  /** Field to sort a platform's comments chronologically. */
  protected abstract sortKey(comment: TComment): number;

  protected generateId(prefix: string): string {
    return `${prefix}_${this.nextId++}`;
  }

  protected getOrSeed(postId: string): TComment[] {
    let comments = this.store.get(postId);
    if (!comments) {
      comments = this.seed(postId);
      this.store.set(postId, comments);
    }
    return comments;
  }

  protected pushComment(postId: string, comment: TComment): TComment {
    this.getOrSeed(postId).push(comment);
    return comment;
  }

  protected async delay(ms = 40): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** `nextOffset` is always the resume point for the next call, never a "no more" sentinel. */
  async fetchPage(
    postId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: TComment[]; nextOffset: number }> {
    await this.delay();
    const all = this.getOrSeed(postId)
      .slice()
      .sort((a, b) => this.sortKey(a) - this.sortKey(b));
    const page = all.slice(offset, offset + limit);
    return { items: page, nextOffset: offset + page.length };
  }

  async findById(postId: string, commentId: string): Promise<TComment | null> {
    await this.delay(10);
    const all = this.getOrSeed(postId);
    return all.find((c) => c.id === commentId) ?? null;
  }
}
