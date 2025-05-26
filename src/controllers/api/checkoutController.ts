import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';

const prisma = new PrismaClient();
interface Seat {
    seatId: string | number;
    status: string;
    price: number;
    ticketTypeName: string;
    type_id: number;
}

export const checkout = async (req: Request, res: Response) => {
    const schema = z.object({
        first_name: z.string().min(1, 'First name is required'),
        last_name: z.string().min(1, 'Last name is required'),
        contact_number: z.string().min(1, 'Contact number is required'),
        email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
        nic_passport: z.string().min(1, 'NIC/Passport is required'),
        country: z.string().min(1, 'Country is required'),
        event_id: z.string().min(1, 'Event id is required'),
        user_id: z.string().min(1, 'User id is required'),
        seat_ids: z.preprocess((val) => {
            if (typeof val === 'string') {
                try {
                    return JSON.parse(val);
                } catch {
                    return [];
                }
            }
            return val;
        }, z.array(z.union([z.number(), z.string()])).min(1, 'At least one seat must be selected')),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }
    const { email, first_name, last_name, contact_number, nic_passport, country, event_id, user_id, seat_ids } = result.data;

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


        // IMPORTANT: Parse the JSON string from the database
        const eventSeats: Seat[] = typeof event.seats === 'string'
        ? JSON.parse(event.seats)
        : event.seats;

        const groupedSeats: { [ticketTypeName: string]: string[] } = {};
        const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};
        let subTotal = 0;

        for (const seatId of seat_ids) {
            // Ensure seatId is treated consistently as a string for map keys if it can be number or string
            const foundSeat: Seat | undefined = eventSeats.find((seat: Seat) => seat.seatId.toString() === seatId.toString());

            if (!foundSeat) {
                return res.status(400).json({ message: `Seat ${seatId} not found or invalid for this event.` });
            }
            if (foundSeat.status !== 'available') {
                return res.status(400).json({ message: `Seat ${seatId} is already ${foundSeat.status}.` });
            }

            const ticketTypeName = foundSeat.ticketTypeName;
            if (!groupedSeats[ticketTypeName]) {
                groupedSeats[ticketTypeName] = [];
            }
            groupedSeats[ticketTypeName].push(seatId.toString());
            seatDetailsMap[seatId.toString()] = { price: foundSeat.price, ticketTypeName: foundSeat.ticketTypeName, type_id: foundSeat.type_id };
            subTotal += foundSeat.price;
        }

        const order = await prisma.order.create({
            data: {
                email,
                first_name,
                last_name,
                contact_number,
                nic_passport,
                country,
                event_id: event_id,
                user_id: user_id,
                seat_ids: seat_ids,
                sub_total: subTotal,
                discount: 0,
                total: subTotal,
                status: 'pending',
            },
        });

        const qrCodes: { ticketTypeName: string; count: number; qrCodeData: string; type_id: number; seat_ids_for_type: string[] }[] = [];

        for (const ticketTypeName in groupedSeats) {
            if (Object.prototype.hasOwnProperty.call(groupedSeats, ticketTypeName)) {
                const seatsForType = groupedSeats[ticketTypeName];
                const count = seatsForType.length;

                const sampleSeatId = seatsForType[0];
                const type_id = seatDetailsMap[sampleSeatId]?.type_id;

                if (type_id === undefined) {
                    console.warn(`Could not find type_id for ticketTypeName: ${ticketTypeName}`);
                    continue;
                }

                const qrData = JSON.stringify({
                    orderId: order.id,
                    ticketTypeName: ticketTypeName,
                    ticketCount: count,
                    ticketTypeId: type_id,
                    seatIdsForType: seatsForType, 
                });
                const qrCodeDataURL = await QRCode.toDataURL(qrData);
                qrCodes.push({
                    ticketTypeName: ticketTypeName,
                    count: count,
                    qrCodeData: qrCodeDataURL,
                    type_id: type_id,
                    seat_ids_for_type: seatsForType,
                });
            }
        }

        const updatedSeats = eventSeats.map((seat: Seat) => {
            if (seat_ids.map(String).includes(seat.seatId.toString())) {
                return { ...seat, status: 'booked' };
            }
            return seat;
        });

        await prisma.event.update({
            where: { id: parseInt(event_id) },
            data: {
                seats: JSON.stringify(updatedSeats),
            },
        });

        return res.status(201).json({
            message: 'Order created successfully and seats booked',
            order_id: order.id,
            qr_codes: qrCodes,
        });
    } catch (err) {
        console.error('Checkout error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};