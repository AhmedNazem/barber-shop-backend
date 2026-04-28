/*
  Warnings:

  - Added the required column `neighborhood` to the `Shop` table without a default value. This is not possible if the table is not empty.
  - Added the required column `neighborhoodAr` to the `Shop` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "neighborhood" TEXT NOT NULL,
ADD COLUMN     "neighborhoodAr" TEXT NOT NULL;
