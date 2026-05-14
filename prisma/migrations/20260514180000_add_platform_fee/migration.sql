-- AlterTable: add platform fee and shop payout to Booking
ALTER TABLE "Booking" ADD COLUMN "platformFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "shopPayout"  INTEGER NOT NULL DEFAULT 0;
