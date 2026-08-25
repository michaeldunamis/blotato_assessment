import type { PrismaClient, SocialAccount } from "@prisma/client";

export interface ISocialAccountRepository {
  findById(id: string): Promise<SocialAccount | null>;
}

export class SocialAccountRepository implements ISocialAccountRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<SocialAccount | null> {
    return this.db.socialAccount.findUnique({ where: { id } });
  }
}
