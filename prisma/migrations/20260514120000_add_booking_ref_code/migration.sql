-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "refCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_refCode_key" ON "Booking"("refCode");
