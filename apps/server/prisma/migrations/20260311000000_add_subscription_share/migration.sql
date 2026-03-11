-- CreateTable
CREATE TABLE "SubscriptionShare" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionShare_shareToken_key" ON "SubscriptionShare"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionShare_subscriptionId_userId_key" ON "SubscriptionShare"("subscriptionId", "userId");

-- AddForeignKey
ALTER TABLE "SubscriptionShare" ADD CONSTRAINT "SubscriptionShare_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionShare" ADD CONSTRAINT "SubscriptionShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
