/*
  Warnings:

  - You are about to drop the column `nice_passport` on the `UserDetails` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "UserDetails" DROP COLUMN "nice_passport",
ADD COLUMN     "nic_passport" TEXT;
