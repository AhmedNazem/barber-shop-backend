-- CreateEnum
CREATE TYPE "PlanPaymentStatus" AS ENUM ('AWAITING_CONFIRMATION', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlanPayment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "plan" "ShopPlan" NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "amount" INTEGER NOT NULL,
    "refCode" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" "PlanPaymentStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "referenceNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPayment_refCode_key" ON "PlanPayment"("refCode");

-- CreateIndex
CREATE INDEX "PlanPayment_shopId_status_idx" ON "PlanPayment"("shopId", "status");

-- AddForeignKey
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
