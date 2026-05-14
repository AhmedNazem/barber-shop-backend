-- AlterEnum: extend PaymentStatus with payment-model states
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "PaymentStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "PaymentStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIAL_REFUND';

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('ZAINCASH', 'FIB', 'PAYTABS', 'CASH');

-- AlterTable: add receiptUrl to Booking
ALTER TABLE "Booking" ADD COLUMN "receiptUrl" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "depositAmount" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'IQD',
    "gatewayTxId" TEXT,
    "gatewayResponse" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
