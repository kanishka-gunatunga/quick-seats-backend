/*
  Warnings:

  - Changed the type of `seat_ids` on the `Order` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "seat_ids",
ADD COLUMN     "seat_ids" JSONB NOT NULL;
