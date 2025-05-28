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

        const seats: Array<{ seatId: string; status: string; [key: string]: any }> = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;

        const seatIndex = seats.findIndex(seat => seat.seatId === seat_id);

        if (seatIndex === -1) {
            return res.status(404).json({ message: 'Seat not found for this event.' });
        }

        const selectedSeat = seats[seatIndex];

        if (selectedSeat.status !== 'available') {
            return res.status(400).json({ message: `Seat ${seat_id} is currently ${selectedSeat.status}. Only 'available' seats can be selected.` });
        }

        seats[seatIndex].status = 'pending';

        await prisma.event.update({
            where: { id: parseInt(event_id) },
            data: {
                seats: seats,
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
        let seats: Array<{ seatId: string; status: string; [key: string]: any }> = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;
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
                seats: seats,
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