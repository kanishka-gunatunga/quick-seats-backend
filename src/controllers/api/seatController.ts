import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: 'mail.techvoice.lk',
    port: 465,
    secure: true,
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD, 
    },
});

const prisma = new PrismaClient();
interface Seat {
    seatId: string | number;
    status: string;
    price: number;
    ticketTypeName: string;
    type_id: number;
}
export const selectSeat = async (req: Request, res: Response) => {
    const schema = z.object({
        event_id: z.string().min(1, 'Event id is required'),
        seat_id: z.string().min(1, 'Seat id is required'),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }
    const { event_id, seat_id } = result.data;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(event_id) },
            select: {
                seats: true,
            },
        });

        if (!event || event.seats === null) {
            return res.status(404).json({ message: 'Event not found or has no seat data.' });
        }

        // Ensure seats is an array by parsing if it's a string, or handling directly if it's already an array
        let seats: Array<{ seatId: string; status: string; [key: string]: any }>;

        if (typeof event.seats === 'string') {
            try {
                seats = JSON.parse(event.seats) as Array<{ seatId: string; status: string; [key: string]: any }>;
            } catch (parseError) {
                console.error("Failed to parse event.seats as JSON:", parseError);
                return res.status(500).json({ message: "Failed to parse seat data from database." });
            }
        } else if (Array.isArray(event.seats)) {
            seats = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;
        } else {
            // Handle cases where event.seats is neither a string nor an array (e.g., an object not in array format)
            console.error("event.seats is not a string or an array:", event.seats);
            return res.status(500).json({ message: "Invalid format for seat data in database." });
        }


        const seatIndex = seats.findIndex(seat => seat.seatId === seat_id);

        if (seatIndex === -1) {
            return res.status(404).json({ message: 'Seat not found for this event.' });
        }

        const selectedSeat = seats[seatIndex];

        if (selectedSeat.status !== 'available') {
            return res.status(400).json({ message: `Seat ${seat_id} is currently ${selectedSeat.status}. Only 'available' seats can be selected.` });
        }

        seats[seatIndex].status = 'pending';

        await prisma.seatReservation.create({
                data: {
                    event_id: event_id,
                    seat_id: seat_id,
                },
            });

        await prisma.event.update({
            where: { id: parseInt(event_id) },
            data: {
                // Ensure you're storing it back in the correct format (e.g., JSON string if that's how your DB expects it)
                seats: typeof event.seats === 'string' ? JSON.stringify(seats) : seats,
            },
        });

        return res.status(200).json({
            message: `Seat ${seat_id} has been marked as 'pending'.`,
            seat: seats[seatIndex]
        });

    } catch (err) {
        console.error('Seat selection error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
export const unselectSeat = async (req: Request, res: Response) => {
    const schema = z.object({
        event_id: z.string().min(1, 'Event id is required'),
        seat_id: z.string().min(1, 'Seat id is required'),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }
    const { event_id, seat_id } = result.data;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(event_id) },
            select: {
                seats: true,
            },
        });

        if (!event || event.seats === null) {
            return res.status(404).json({ message: 'Event not found or has no seat data.' });
        }

        // Ensure seats is an array by parsing if it's a string, or handling directly if it's already an array
        let seats: Array<{ seatId: string; status: string; [key: string]: any }>;

        if (typeof event.seats === 'string') {
            try {
                seats = JSON.parse(event.seats) as Array<{ seatId: string; status: string; [key: string]: any }>;
            } catch (parseError) {
                console.error("Failed to parse event.seats as JSON:", parseError);
                return res.status(500).json({ message: "Failed to parse seat data from database." });
            }
        } else if (Array.isArray(event.seats)) {
            seats = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;
        } else {
            // Handle cases where event.seats is neither a string nor an array (e.g., an object not in array format)
            console.error("event.seats is not a string or an array:", event.seats);
            return res.status(500).json({ message: "Invalid format for seat data in database." });
        }


        const seatIndex = seats.findIndex(seat => seat.seatId === seat_id);

        if (seatIndex === -1) {
            return res.status(404).json({ message: 'Seat not found for this event.' });
        }

        const selectedSeat = seats[seatIndex];

        if (selectedSeat.status !== 'pending') {
            return res.status(400).json({ message: `Seat ${seat_id} is currently ${selectedSeat.status}. Only 'pending' seats can be unselected.` });
        }

        seats[seatIndex].status = 'available';

           await prisma.seatReservation.deleteMany({
                where: {
                    event_id: event_id,
                    seat_id: seat_id,
                },
            });
        await prisma.event.update({
            where: { id: parseInt(event_id) },
            data: {
                // Ensure you're storing it back in the correct format (e.g., JSON string if that's how your DB expects it)
                seats: typeof event.seats === 'string' ? JSON.stringify(seats) : seats,
            },
        });

        return res.status(200).json({
            message: `Seat ${seat_id} has been marked as 'available'.`,
            seat: seats[seatIndex]
        });

    } catch (err) {
        console.error('Seat selection error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
export const resetSeats = async (req: Request, res: Response) => {
    const schema = z.object({
        event_id: z.string().min(1, 'Event id is required'),
        seat_ids: z.preprocess((val) => {
            if (typeof val === 'string') {
                try {
                    return JSON.parse(val);
                } catch {
                    return [];
                }
            }
            return val;
        }, z.array(z.string()).min(1, 'At least one seat ID must be provided')),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }
    const { event_id, seat_ids } = result.data;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(event_id) },
            select: {
                seats: true,
            },
        });

        if (!event || event.seats === null) {
            return res.status(404).json({ message: 'Event not found or has no seat data.' });
        }

        // --- Start of fix ---
        let seats: Array<{ seatId: string; status: string; [key: string]: any }>;

        if (typeof event.seats === 'string') {
            try {
                seats = JSON.parse(event.seats) as Array<{ seatId: string; status: string; [key: string]: any }>;
            } catch (parseError) {
                console.error("Failed to parse event.seats as JSON in resetSeats:", parseError);
                return res.status(500).json({ message: "Failed to parse seat data from database." });
            }
        } else if (Array.isArray(event.seats)) {
            seats = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;
        } else {
            console.error("event.seats is not a string or an array in resetSeats:", event.seats);
            return res.status(500).json({ message: "Invalid format for seat data in database." });
        }
        // --- End of fix ---

        const updatedSeatIds: string[] = [];
        const notFoundSeatIds: string[] = [];

        for (const seatIdToReset of seat_ids) {
            const seatIndex = seats.findIndex(seat => seat.seatId === seatIdToReset);

            if (seatIndex !== -1) {
                seats[seatIndex].status = 'available';
                updatedSeatIds.push(seatIdToReset);
            } else {
                notFoundSeatIds.push(seatIdToReset);
            }
        }

        if (updatedSeatIds.length === 0 && notFoundSeatIds.length > 0) {
            return res.status(404).json({
                message: 'None of the provided seats were found for this event.',
                notFoundSeatIds: notFoundSeatIds,
            });
        }
     
        await prisma.event.update({
            where: { id: parseInt(event_id) },
            data: {
                // Ensure you're storing it back in the correct format (e.g., JSON string if that's how your DB expects it)
                seats: typeof event.seats === 'string' ? JSON.stringify(seats) : seats,
            },
        });

        return res.status(200).json({
            message: 'Selected seats have been reset to "available".',
            resetSeats: updatedSeatIds,
            notFoundSeats: notFoundSeatIds,
        });

    } catch (err) {
        console.error('Seat reset error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

type TicketDetail = {
    price: number;
    ticketCount: number | null;
    ticketTypeId: number;
    hasTicketCount: boolean;
    bookedTicketCount: number;
};
export const checkSeatCount = async (req: Request, res: Response) => {
    const schema = z.object({
        event_id: z.string().min(1, 'Event id is required'),
        ticket_type_id: z.string().min(1, 'Ticket type id is required'),
        count: z.string().min(1, 'Count is required'),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }

    const { event_id, ticket_type_id, count } = result.data;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(event_id) },
            select: {
                ticket_details: true,
            },
        });

        if (!event || !event.ticket_details) {
            return res.status(404).json({ message: 'Event not found or has no seat data.' });
        }

        // Cast the ticket_details to the expected array of objects
        const ticketDetails = event.ticket_details as TicketDetail[];

        const ticketTypeId = parseInt(ticket_type_id);
        const requestedCount = parseInt(count);

        const ticket = ticketDetails.find(t => t.ticketTypeId === ticketTypeId);

        if (!ticket) {
            return res.status(404).json({ message: 'Ticket type not found in event.' });
        }

        if (!ticket.hasTicketCount) {
            return res.status(200).json({ message: 'Seats not avialble to book a ticket count', available: false });
        }

        const availableSeats = (ticket.ticketCount ?? 0) - ticket.bookedTicketCount;

        if (availableSeats >= requestedCount) {
            return res.status(200).json({ message: 'Seats available', available: true });
        } else {
            return res.status(200).json({
                message: `Only ${availableSeats} seats are available.`,
                available: false,
            });
        }

    } catch (err) {
        console.error('Seat selection error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};