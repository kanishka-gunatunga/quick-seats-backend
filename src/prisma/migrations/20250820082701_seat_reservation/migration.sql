-- CreateTable
CREATE TABLE "SeatReservation" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "event_id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatReservation_pkey" PRIMARY KEY ("id")
);
