/*
  Warnings:

  - A unique constraint covering the columns `[cybersource_transaction_uuid]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cybersource_transaction_uuid" TEXT,
ALTER COLUMN "status" SET DEFAULT 'pending';

-- CreateIndex
CREATE UNIQUE INDEX "Order_cybersource_transaction_uuid_key" ON "Order"("cybersource_transaction_uuid");
