-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tickets_without_seats" JSONB,
ALTER COLUMN "seat_ids" DROP NOT NULL;
