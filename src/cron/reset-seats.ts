import { PrismaClient } from '@prisma/client';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const prisma = new PrismaClient();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        // Calculate the timestamp for 15 minutes ago
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        // Find all seat reservations that are older than 15 minutes
        const expiredReservations = await prisma.seatReservation.findMany({
            where: {
                createdAt: {
                    lt: fifteenMinutesAgo, // 'lt' stands for 'less than'
                },
            },
        });
        console.log('expiredReservations', expiredReservations);
        
        // Loop through each expired reservation to release the seat and delete the record
        for (const reservation of expiredReservations) {
            console.log(`Processing expired reservation for seat: ${reservation.seat_id} in event: ${reservation.event_id}`);
            
            // Step 1: Find the event and seat data
            const event = await prisma.event.findUnique({
                where: { id: parseInt(reservation.event_id) },
                select: { seats: true, id: true },
            });

            if (!event || event.seats === null) {
                console.warn(`Event or seat data not found for event ID: ${reservation.event_id}. Skipping and deleting reservation.`);
                await prisma.seatReservation.delete({ where: { id: reservation.id } });
                continue;
            }

            let seats: Array<{ seatId: string; status: string; [key: string]: any }>;

            // Ensure seats data is an array (handle both JSON string and array format)
            if (typeof event.seats === 'string') {
                try {
                    seats = JSON.parse(event.seats) as Array<{ seatId: string; status: string; [key: string]: any }>;
                } catch (parseError) {
                    console.error("Failed to parse event.seats as JSON. Skipping and deleting reservation.", parseError);
                    await prisma.seatReservation.delete({ where: { id: reservation.id } });
                    continue;
                }
            } else if (Array.isArray(event.seats)) {
                seats = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;
            } else {
                console.error("Invalid format for seat data in database. Skipping and deleting reservation.", event.seats);
                await prisma.seatReservation.delete({ where: { id: reservation.id } });
                continue;
            }

            // Step 2: Update the seat status to 'available'
            const seatIndex = seats.findIndex(seat => seat.seatId === reservation.seat_id);

            if (seatIndex !== -1) {
                // If the seat exists, update its status
                if (seats[seatIndex].status === 'pending') {
                    // If the seat exists and is pending, update its status
                    seats[seatIndex].status = 'available';

                    // Update the event record in the database
                    await prisma.event.update({
                        where: { id: event.id },
                        data: {
                            seats: typeof event.seats === 'string' ? JSON.stringify(seats) : seats,
                        },
                    });
                    console.log(`Seat ${reservation.seat_id} in event ${event.id} marked as 'available'.`);
                } else {
                    console.warn(`Seat ${reservation.seat_id} is not in 'pending' status. Skipping update.`);
                }
            } else {
                console.warn(`Seat ${reservation.seat_id} not found in event ${event.id}. It may have been booked or deleted. Skipping.`);
            }

            // Step 3: Delete the expired reservation record
            await prisma.seatReservation.delete({
                where: { id: reservation.id },
            });
            console.log(`Expired reservation record ${reservation.id} deleted.`);
        }

        return res.status(200).json({ message: 'Seat cleanup completed successfully.' });
    } catch (error) {
        console.error('An error occurred during seat cleanup:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        await prisma.$disconnect();
    }
}