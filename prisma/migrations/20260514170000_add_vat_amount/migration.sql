-- AlterTable: add VAT amount to Booking (defaults to 0 for existing bookings)
ALTER TABLE "Booking" ADD COLUMN "vatAmount" INTEGER NOT NULL DEFAULT 0;
