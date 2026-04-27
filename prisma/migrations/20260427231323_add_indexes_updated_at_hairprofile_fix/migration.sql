/*
  Warnings:

  - You are about to drop the column `concerns` on the `HairProfile` table. All the data in the column will be lost.
  - You are about to drop the column `goals` on the `HairProfile` table. All the data in the column will be lost.
  - You are about to drop the column `texture` on the `HairProfile` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Barber` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cutFrequencyWeeks` to the `HairProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `damage` to the `HairProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dryness` to the `HairProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `scalpCondition` to the `HairProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `QueueEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Review` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Service` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Shop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `ShopDiscount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Barber" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "HairProfile" DROP COLUMN "concerns",
DROP COLUMN "goals",
DROP COLUMN "texture",
ADD COLUMN     "cutFrequencyWeeks" INTEGER NOT NULL,
ADD COLUMN     "damage" INTEGER NOT NULL,
ADD COLUMN     "dryness" INTEGER NOT NULL,
ADD COLUMN     "lastTreatmentDate" TEXT,
ADD COLUMN     "scalpCondition" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "rejectionReasonAr" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "ShopDiscount" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "HairAnalysisHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hairType" TEXT NOT NULL,
    "conditionScore" INTEGER NOT NULL,
    "dryness" INTEGER NOT NULL,
    "damage" INTEGER NOT NULL,
    "scalpCondition" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HairAnalysisHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HairAnalysisHistory_userId_idx" ON "HairAnalysisHistory"("userId");

-- CreateIndex
CREATE INDEX "InviteCode_expiresAt_idx" ON "InviteCode"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "HairAnalysisHistory" ADD CONSTRAINT "HairAnalysisHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "HairProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
