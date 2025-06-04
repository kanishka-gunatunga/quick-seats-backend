import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';
import transporter from '../../services/mailTransporter';
import ejs from 'ejs';
import path from 'path';

const prisma = new PrismaClient();

interface Seat {
    seatId: string | number;
    status: string;
    price: number;
    ticketTypeName: string;
    type_id: number;
}

interface TicketWithoutSeat {
    ticket_type_id: number;
    ticket_count: number;
}

interface EventTicketDetail {
    price: number;
    ticketCount: number | null;
    ticketTypeId: number;
    hasTicketCount: boolean;
    bookedTicketCount: number;
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
        }, z.array(z.union([z.number(), z.string()])).optional()),
        tickets_without_seats: z.preprocess((val) => {
            if (typeof val === 'string') {
                try {
                    return JSON.parse(val);
                } catch {
                    return [];
                }
            }
            return val;
        }, z.array(z.object({
            ticket_type_id: z.number().int(),
            ticket_count: z.number().int().min(1, 'Ticket count must be at least 1'),
        })).optional()),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }

    const {
        email,
        first_name,
        last_name,
        contact_number,
        nic_passport,
        country,
        event_id,
        user_id,
        seat_ids = [], 
        tickets_without_seats = [], 
    } = result.data;

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(event_id) },
            select: {
                name: true,
                seats: true,
                ticket_details: true, 
            },
        });

        if (!event) {
            return res.status(404).json({ message: 'Event not found.' });
        }

        let eventSeats: Seat[] = [];
        if (event.seats) {
            eventSeats = typeof event.seats === 'string'
                ? JSON.parse(event.seats)
                : event.seats;
        }

        let eventTicketDetails: EventTicketDetail[] = [];
        if (event.ticket_details) {
            eventTicketDetails = typeof event.ticket_details === 'string'
                ? JSON.parse(event.ticket_details)
                : event.ticket_details;
        }

        const groupedSeats: { [ticketTypeName: string]: string[] } = {};
        const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};
        let subTotal = 0;

        for (const seatId of seat_ids) {
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

        const groupedTicketsWithoutSeats: { [ticketTypeName: string]: { count: number; type_id: number; price: number } } = {};
        const ticketWithoutSeatDetailsForOrder: { ticket_type_id: number; ticket_count: number; price: number; ticketTypeName: string }[] = [];

        for (const ticketInfo of tickets_without_seats) {
            const ticketDetail = eventTicketDetails.find(td => td.ticketTypeId === ticketInfo.ticket_type_id);

            if (!ticketDetail) {
                return res.status(400).json({ message: `Ticket type ID ${ticketInfo.ticket_type_id} not found for this event.` });
            }

            if (ticketDetail.hasTicketCount && (ticketDetail.bookedTicketCount + ticketInfo.ticket_count > (ticketDetail.ticketCount || 0))) {
                return res.status(400).json({ message: `Not enough tickets available for type ${ticketInfo.ticket_type_id}. Only ${((ticketDetail.ticketCount || 0) - ticketDetail.bookedTicketCount)} remaining.` });
            }

            ticketDetail.bookedTicketCount += ticketInfo.ticket_count;
            subTotal += ticketDetail.price * ticketInfo.ticket_count;

            // For QR code generation and order saving
            const ticketTypeName = `Ticket Type ${ticketInfo.ticket_type_id}`; // You might want to fetch the actual name from a separate table or event.ticket_details if available
            if (!groupedTicketsWithoutSeats[ticketTypeName]) {
                groupedTicketsWithoutSeats[ticketTypeName] = { count: 0, type_id: ticketInfo.ticket_type_id, price: ticketDetail.price };
            }
            groupedTicketsWithoutSeats[ticketTypeName].count += ticketInfo.ticket_count;
            
            ticketWithoutSeatDetailsForOrder.push({
                ticket_type_id: ticketInfo.ticket_type_id,
                ticket_count: ticketInfo.ticket_count,
                price: ticketDetail.price,
                ticketTypeName: ticketTypeName // This will be used for email and QR
            });
        }

        // Create the order
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
                tickets_without_seats: tickets_without_seats, // Save the raw input for tickets without seats
                sub_total: subTotal,
                discount: 0,
                total: subTotal,
                status: 'pending',
            },
        });

        const qrCodes: { ticketTypeName: string; count: number; qrCodeData: string; type_id: number; seat_ids_for_type?: string[] }[] = [];

        // Generate QR codes for seats
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

        // Generate QR codes for tickets without seats
        for (const ticketTypeName in groupedTicketsWithoutSeats) {
            if (Object.prototype.hasOwnProperty.call(groupedTicketsWithoutSeats, ticketTypeName)) {
                const ticketInfo = groupedTicketsWithoutSeats[ticketTypeName];

                const qrData = JSON.stringify({
                    orderId: order.id,
                    ticketTypeName: ticketTypeName,
                    ticketCount: ticketInfo.count,
                    ticketTypeId: ticketInfo.type_id,
                    // No seat_ids_for_type for these tickets
                });
                const qrCodeDataURL = await QRCode.toDataURL(qrData);
                qrCodes.push({
                    ticketTypeName: ticketTypeName,
                    count: ticketInfo.count,
                    qrCodeData: qrCodeDataURL,
                    type_id: ticketInfo.type_id,
                });
            }
        }

        // Update seats status
        const updatedSeats = eventSeats.map((seat: Seat) => {
            if (seat_ids.map(String).includes(seat.seatId.toString())) {
                return { ...seat, status: 'booked' };
            }
            return seat;
        });

        // Update event with new seat status and updated ticket_details
        await prisma.event.update({
            where: { id: parseInt(event_id) },
            data: {
                seats: JSON.stringify(updatedSeats),
                ticket_details: JSON.stringify(eventTicketDetails), // Save updated ticket_details
            },
        });

        const attachments: any[] = [];
        qrCodes.forEach((qr, index) => {
            attachments.push({
                filename: `ticket-${qr.ticketTypeName.replace(/\s/g, '-')}-${index + 1}.png`,
                content: qr.qrCodeData.split("base64,")[1],
                encoding: 'base64',
                cid: `qr${index}@event.com`,
            });
        });

        // Prepare details for the email template
        const booked_seats_details = Object.keys(groupedSeats).map(ticketTypeName => {
            const seats = groupedSeats[ticketTypeName];
            return `${ticketTypeName}: ${seats.join(', ')}`;
        }).join('; ');

        const booked_tickets_without_seats_details = Object.keys(groupedTicketsWithoutSeats).map(ticketTypeName => {
            const ticketInfo = groupedTicketsWithoutSeats[ticketTypeName];
            return `${ticketTypeName}: ${ticketInfo.count} tickets`;
        }).join('; ');

        const allBookedDetails = [booked_seats_details, booked_tickets_without_seats_details].filter(Boolean).join('; ');

        const templatePath = path.join(__dirname, '../../views/email-templates/qr-template.ejs');
        const qrEmailHtml = await ejs.renderFile(templatePath, {
            first_name: first_name,
            event_name: event.name,
            booked_seats_details: allBookedDetails, // Use combined details
            qrCodes: qrCodes,
        });

        await transporter.sendMail({
            from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
            to: email,
            subject: 'Your Event QR Tickets',
            html: qrEmailHtml,
            attachments: attachments,
        });

        return res.status(201).json({
            message: 'Order created successfully, tickets booked, and QR codes emailed',
            order_id: order.id,
            qr_codes: qrCodes,
        });
    } catch (err) {
        console.error('Checkout error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
// export const checkout = async (req: Request, res: Response) => {
//     const schema = z.object({
//         first_name: z.string().min(1, 'First name is required'),
//         last_name: z.string().min(1, 'Last name is required'),
//         contact_number: z.string().min(1, 'Contact number is required'),
//         email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
//         nic_passport: z.string().min(1, 'NIC/Passport is required'),
//         country: z.string().min(1, 'Country is required'),
//         event_id: z.string().min(1, 'Event id is required'),
//         user_id: z.string().min(1, 'User id is required'), 
//         seat_ids: z.preprocess((val) => {
//             if (typeof val === 'string') {
//                 try {
//                     return JSON.parse(val);
//                 } catch {
//                     return [];
//                 }
//             }
//             return val;
//         }, z.array(z.union([z.number(), z.string()])).optional()),
//     });

//     const result = schema.safeParse(req.body);

//     if (!result.success) {
//         return res.status(400).json({
//             message: 'Invalid input',
//             errors: result.error.flatten(),
//         });
//     }
//     const { email, first_name, last_name, contact_number, nic_passport, country, event_id, user_id, seat_ids } = result.data;

//     try {
//         const event = await prisma.event.findUnique({
//             where: { id: parseInt(event_id) },
//             select: {
//                 name: true,
//                 seats: true,
//             },
//         });

//          if (!event || event.seats === null) {
//             return res.status(404).json({ message: 'Event not found or has no seat data.' });
//         }

//         const eventSeats: Seat[] = typeof event.seats === 'string'
//         ? JSON.parse(event.seats)
//         : event.seats;

//         const groupedSeats: { [ticketTypeName: string]: string[] } = {};
//         const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};
//         let subTotal = 0;

//         for (const seatId of seat_ids) {

//             const foundSeat: Seat | undefined = eventSeats.find((seat: Seat) => seat.seatId.toString() === seatId.toString());

//             if (!foundSeat) {
//                 return res.status(400).json({ message: `Seat ${seatId} not found or invalid for this event.` });
//             }
//             if (foundSeat.status !== 'available') {
//                 return res.status(400).json({ message: `Seat ${seatId} is already ${foundSeat.status}.` });
//             }

//             const ticketTypeName = foundSeat.ticketTypeName;
//             if (!groupedSeats[ticketTypeName]) {
//                 groupedSeats[ticketTypeName] = [];
//             }
//             groupedSeats[ticketTypeName].push(seatId.toString());
//             seatDetailsMap[seatId.toString()] = { price: foundSeat.price, ticketTypeName: foundSeat.ticketTypeName, type_id: foundSeat.type_id };
//             subTotal += foundSeat.price;
//         }

//         const order = await prisma.order.create({
//             data: {
//                 email,
//                 first_name,
//                 last_name,
//                 contact_number,
//                 nic_passport,
//                 country,
//                 event_id: event_id,
//                 user_id: user_id,
//                 seat_ids: seat_ids,
//                 tickets_without_seats: tickets_without_seats,
//                 sub_total: subTotal,
//                 discount: 0,
//                 total: subTotal,
//                 status: 'pending',
//             },
//         });

//         const qrCodes: { ticketTypeName: string; count: number; qrCodeData: string; type_id: number; seat_ids_for_type: string[] }[] = [];

//         for (const ticketTypeName in groupedSeats) {
//             if (Object.prototype.hasOwnProperty.call(groupedSeats, ticketTypeName)) {
//                 const seatsForType = groupedSeats[ticketTypeName];
//                 const count = seatsForType.length;

//                 const sampleSeatId = seatsForType[0];
//                 const type_id = seatDetailsMap[sampleSeatId]?.type_id;

//                 if (type_id === undefined) {
//                     console.warn(`Could not find type_id for ticketTypeName: ${ticketTypeName}`);
//                     continue;
//                 }

//                 const qrData = JSON.stringify({
//                     orderId: order.id,
//                     ticketTypeName: ticketTypeName,
//                     ticketCount: count,
//                     ticketTypeId: type_id,
//                     seatIdsForType: seatsForType, 
//                 });
//                 const qrCodeDataURL = await QRCode.toDataURL(qrData);
//                 qrCodes.push({
//                     ticketTypeName: ticketTypeName,
//                     count: count,
//                     qrCodeData: qrCodeDataURL,
//                     type_id: type_id,
//                     seat_ids_for_type: seatsForType,
//                 });
//             }
//         }

//         const updatedSeats = eventSeats.map((seat: Seat) => {
//             if (seat_ids.map(String).includes(seat.seatId.toString())) {
//                 return { ...seat, status: 'booked' };
//             }
//             return seat;
//         });

//         await prisma.event.update({
//             where: { id: parseInt(event_id) },
//             data: {
//                 seats: JSON.stringify(updatedSeats),
//             },
//         });
//         const attachments: any[] = [];
//         qrCodes.forEach((qr, index) => {
//             attachments.push({
//                 filename: `ticket-${qr.ticketTypeName}-${index + 1}.png`,
//                 content: qr.qrCodeData.split("base64,")[1],
//                 encoding: 'base64',
//                 cid: `qr${index}@event.com`,
//             });
//         });
//         const booked_seats_details = Object.keys(groupedSeats).map(ticketTypeName => {
//             const seats = groupedSeats[ticketTypeName];
//             return `${ticketTypeName}: ${seats.join(', ')}`;
//         }).join('; ');
        
//         const templatePath = path.join(__dirname, '../../views/email-templates/qr-template.ejs');
//         const qrEmailHtml = await ejs.renderFile(templatePath, {
//             first_name: first_name,
//             event_name: event.name,
//             booked_seats_details: booked_seats_details,
//             qrCodes: qrCodes,
//         });
//         await transporter.sendMail({
//             from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
//             to: email,
//             subject: 'Your Event QR Tickets',
//             html: qrEmailHtml,
//             attachments: attachments,
//         });

//         return res.status(201).json({
//             message: 'Order created successfully, seats booked, and QR codes emailed',
//             order_id: order.id,
//             qr_codes: qrCodes,
//         });
//     } catch (err) {
//         console.error('Checkout error:', err);
//         return res.status(500).json({ message: 'Internal server error' });
//     }
// };