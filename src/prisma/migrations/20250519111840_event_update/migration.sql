/*
  Warnings:

  - You are about to drop the column `artistDetails` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `bannerImage` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `endDateTime` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `featuredImage` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `organizedBy` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `startDateTime` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `ticketDetails` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `ticketPolicy` on the `Event` table. All the data in the column will be lost.
  - Added the required column `end_date_time` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organized_by` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `policy` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start_date_time` to the `Event` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Event" DROP COLUMN "artistDetails",
DROP COLUMN "bannerImage",
DROP COLUMN "endDateTime",
DROP COLUMN "featuredImage",
DROP COLUMN "organizedBy",
DROP COLUMN "startDateTime",
DROP COLUMN "ticketDetails",
DROP COLUMN "ticketPolicy",
ADD COLUMN     "artist_details" JSONB,
ADD COLUMN     "banner_image" TEXT,
ADD COLUMN     "end_date_time" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "featured_image" TEXT,
ADD COLUMN     "organized_by" TEXT NOT NULL,
ADD COLUMN     "policy" TEXT NOT NULL,
ADD COLUMN     "start_date_time" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL,
ADD COLUMN     "ticket_details" JSONB;
