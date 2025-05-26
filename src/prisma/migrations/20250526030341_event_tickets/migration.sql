/*
  Warnings:

  - You are about to drop the column `tickets` on the `Event` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Event" DROP COLUMN "tickets",
ADD COLUMN     "seats" JSONB;
