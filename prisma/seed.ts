import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const twitterAccount = await prisma.socialAccount.upsert({
    where: { platform_externalAccountId: { platform: "twitter", externalAccountId: "acct_tw_1" } },
    create: {
      platform: "twitter",
      externalAccountId: "acct_tw_1",
      displayName: "Blotato (Twitter)",
      accessToken: "fake-token",
    },
    update: {},
  });

  const instagramAccount = await prisma.socialAccount.upsert({
    where: { platform_externalAccountId: { platform: "instagram", externalAccountId: "acct_ig_1" } },
    create: {
      platform: "instagram",
      externalAccountId: "acct_ig_1",
      displayName: "Blotato (Instagram)",
      accessToken: "fake-token",
    },
    update: {},
  });

  const twitterPost = await prisma.post.upsert({
    where: { platform_externalPostId: { platform: "twitter", externalPostId: "tweet_001" } },
    create: {
      platform: "twitter",
      externalPostId: "tweet_001",
      socialAccountId: twitterAccount.id,
      publishedAt: new Date(),
    },
    update: {},
  });

  const instagramPost = await prisma.post.upsert({
    where: { platform_externalPostId: { platform: "instagram", externalPostId: "ig_post_001" } },
    create: {
      platform: "instagram",
      externalPostId: "ig_post_001",
      socialAccountId: instagramAccount.id,
      publishedAt: new Date(),
    },
    update: {},
  });

  console.log("Seeded posts:");
  console.log(`  twitter:   GET /api/posts/${twitterPost.id}/comments`);
  console.log(`  instagram: GET /api/posts/${instagramPost.id}/comments`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
