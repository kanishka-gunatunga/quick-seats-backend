-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "upcoming_event" INTEGER,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "location" DROP NOT NULL,
ALTER COLUMN "end_date_time" DROP NOT NULL,
ALTER COLUMN "organized_by" DROP NOT NULL,
ALTER COLUMN "policy" DROP NOT NULL,
ALTER COLUMN "start_date_time" DROP NOT NULL;
