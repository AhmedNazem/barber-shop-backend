-- AlterEnum: add EXPIRE and BONUS to TransactionType
ALTER TYPE "TransactionType" ADD VALUE 'EXPIRE';
ALTER TYPE "TransactionType" ADD VALUE 'BONUS';

-- AlterTable: add expired flag to LoyaltyTransaction
ALTER TABLE "LoyaltyTransaction" ADD COLUMN "expired" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: fast expiry-scan index
CREATE INDEX "LoyaltyTransaction_type_expired_createdAt_idx" ON "LoyaltyTransaction"("type", "expired", "createdAt");

-- AlterTable: add referral fields to User
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "referredById" TEXT;

-- CreateIndex: unique referral code
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey: self-relation for referrals
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
