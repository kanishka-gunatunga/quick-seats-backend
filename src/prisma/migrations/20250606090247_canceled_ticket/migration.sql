-- CreateTable
CREATE TABLE "canceledTicket" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "seat_id" TEXT,
    "type_id" TEXT,
    "ticketTypeName" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canceledTicket_pkey" PRIMARY KEY ("id")
);
