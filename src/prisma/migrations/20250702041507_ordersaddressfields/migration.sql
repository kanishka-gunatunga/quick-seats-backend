-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ALTER COLUMN "country" DROP NOT NULL;
