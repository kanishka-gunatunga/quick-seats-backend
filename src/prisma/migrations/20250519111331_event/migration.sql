-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "ticketPolicy" TEXT NOT NULL,
    "organizedBy" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "bannerImage" TEXT,
    "featuredImage" TEXT,
    "ticketDetails" JSONB,
    "artistDetails" JSONB,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
