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
            ticket_type_id: z.number(),
            ticket_count: z.number().min(1, 'Ticket count must be at least 1'),
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
        seat_ids = [], // Default to empty array if not provided
        tickets_without_seats = [], // Default to empty array if not provided
    } = result.data;

    console.log('tickets_without_seats', tickets_without_seats); // This should now show the parsed array
    if (seat_ids.length === 0 && tickets_without_seats.length === 0) {
        return res.status(400).json({ message: 'No seats or tickets without seats provided for checkout.' });
    }

    try {
        const event = await prisma.event.findUnique({
            where: { id: parseInt(event_id) },
            select: {
                name: true,
                seats: true,
                ticket_details: true, // Select ticket_details
            },
        });

        if (!event) {
            return res.status(404).json({ message: 'Event not found.' });
        }

        const eventSeats: Seat[] = typeof event.seats === 'string'
            ? JSON.parse(event.seats)
            : event.seats || []; // Ensure it's an array

        const eventTicketDetails: any[] = typeof event.ticket_details === 'string'
            ? JSON.parse(event.ticket_details)
            : event.ticket_details || []; // Ensure it's an array
        console.log('eventTicketDetails', eventTicketDetails); // This should show the parsed details
        const groupedSeats: { [ticketTypeName: string]: string[] } = {};
        const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};
        let subTotal = 0;

        // --- Process seat-based tickets ---
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

        // --- Process tickets without seats and update ticket_details ---
        // Create a deep copy to ensure modifications don't affect the original object until saved
        const updatedTicketDetails = JSON.parse(JSON.stringify(eventTicketDetails));
        const ticketsWithoutSeatsDetails: { ticketTypeName: string; count: number; type_id: number; price: number }[] = [];

        for (const ticket of tickets_without_seats) {
            const ticketDetailIndex = updatedTicketDetails.findIndex((td: any) => td.ticketTypeId === ticket.ticket_type_id);

            if (ticketDetailIndex === -1) {
                return res.status(400).json({ message: `Ticket type ID ${ticket.ticket_type_id} not found for this event.` });
            }

            const currentTicketDetail = updatedTicketDetails[ticketDetailIndex];

            // Check if hasTicketCount is true and if there's enough available
            if (currentTicketDetail.hasTicketCount && currentTicketDetail.ticketCount !== null) {
                if (((currentTicketDetail.bookedTicketCount || 0) + ticket.ticket_count) > currentTicketDetail.ticketCount) {
                    return res.status(400).json({
                        message: `Not enough tickets available for ticket type ID ${ticket.ticket_type_id}. Available: ${currentTicketDetail.ticketCount - (currentTicketDetail.bookedTicketCount || 0)}. Requested: ${ticket.ticket_count}.`
                    });
                }
            }
            // Ensure bookedTicketCount is initialized if it's undefined or null
            currentTicketDetail.bookedTicketCount = (currentTicketDetail.bookedTicketCount || 0) + ticket.ticket_count;
            subTotal += currentTicketDetail.price * ticket.ticket_count;

            ticketsWithoutSeatsDetails.push({
                ticketTypeName: currentTicketDetail.ticketTypeName || `Type ${currentTicketDetail.ticketTypeName}`, 
                count: ticket.ticket_count,
                type_id: ticket.ticket_type_id,
                price: currentTicketDetail.price,
            });
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
                seat_ids: seat_ids.length > 0 ? JSON.stringify(seat_ids) : '[]', // Stringify seat_ids
                tickets_without_seats: tickets_without_seats.length > 0 ? JSON.stringify(tickets_without_seats) : '[]', // Stringify tickets_without_seats
                sub_total: subTotal,
                discount: 0,
                total: subTotal,
                status: 'pending',
            },
        });

        const qrCodes: { ticketTypeName: string; count: number; qrCodeData: string; type_id: number; seat_ids_for_type?: string[]; type: 'seat' | 'no seat' }[] = [];

        // --- Generate QR codes for seat-based tickets ---
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
                    type: "seat", // Add type field
                });
                const qrCodeDataURL = await QRCode.toDataURL(qrData);
                qrCodes.push({
                    ticketTypeName: ticketTypeName,
                    count: count,
                    qrCodeData: qrCodeDataURL,
                    type_id: type_id,
                    seat_ids_for_type: seatsForType,
                    type: "seat",
                });
            }
        }

        // --- Generate QR codes for tickets without seats ---
        for (const ticket of ticketsWithoutSeatsDetails) {
            const qrData = JSON.stringify({
                orderId: order.id,
                ticketTypeName: ticket.ticketTypeName,
                ticketCount: ticket.count,
                ticketTypeId: ticket.type_id,
                type: "no seat", // Add type field
            });
            const qrCodeDataURL = await QRCode.toDataURL(qrData);
            qrCodes.push({
                ticketTypeName: ticket.ticketTypeName,
                count: ticket.count,
                qrCodeData: qrCodeDataURL,
                type_id: ticket.type_id,
                type: "no seat",
            });
        }

        // --- Update event seats and ticket_details ---
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
                ticket_details: JSON.stringify(updatedTicketDetails), // Ensure ticket_details is stringified
            },
        });

        // --- Prepare email attachments ---
        const attachments: any[] = [];
        qrCodes.forEach((qr, index) => {
            attachments.push({
                filename: `ticket-${qr.ticketTypeName}-${qr.type}-${index + 1}.png`,
                content: qr.qrCodeData.split("base64,")[1],
                encoding: 'base64',
                cid: `qr${index}@event.com`,
            });
        });

        // --- Prepare email content ---
        const booked_seats_details = Object.keys(groupedSeats).map(ticketTypeName => {
            const seats = groupedSeats[ticketTypeName];
            return `${ticketTypeName}: ${seats.join(', ')}`;
        }).join('; ');

        const booked_tickets_without_seats_details = ticketsWithoutSeatsDetails.map(ticket => {
            return `${ticket.ticketTypeName} (No Seat): ${ticket.count} tickets`;
        }).join('; ');

        const all_booked_details = [booked_seats_details, booked_tickets_without_seats_details].filter(Boolean).join('; ');


        const templatePath = path.join(__dirname, '../../views/email-templates/qr-template.ejs');
        const qrEmailHtml = await ejs.renderFile(templatePath, {
            first_name: first_name,
            event_name: event.name,
            booked_seats_details: all_booked_details, // Combine details for email
            qrCodes: qrCodes,
        });

        // --- Send email ---
        await transporter.sendMail({
            from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
            to: email,
            subject: 'Your Event QR Tickets',
            html: qrEmailHtml,
            attachments: attachments,
        });

        return res.status(201).json({
            message: 'Order created successfully, seats booked, and QR codes emailed',
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
//         tickets_without_seats: z.preprocess((val) => {
//             if (typeof val === 'string') {
//                 try {
//                     return JSON.parse(val);
//                 } catch {
//                     return [];
//                 }
//             }
//             return val;
//         }, z.array(z.object({
//             ticket_type_id: z.number().int(),
//             ticket_count: z.number().int().min(1, 'Ticket count must be at least 1'),
//         })).optional()),
//     });

//     const result = schema.safeParse(req.body);

//     if (!result.success) {
//         return res.status(400).json({
//             message: 'Invalid input',
//             errors: result.error.flatten(),
//         });
//     }
//     const { email, first_name, last_name, contact_number, nic_passport, country, event_id, user_id, seat_ids= [],tickets_without_seats = [] } = result.data;

//     try {
//         const event = await prisma.event.findUnique({
//             where: { id: parseInt(event_id) },
//             select: {
//                 name: true,
//                 seats: true,
//                 ticket_details: true,
//             },
//         });

//          if (!event || !event.seats) {
//             return res.status(404).json({ message: 'Event not found or has no seat data.' });
//         }

//         const eventSeats: Seat[] = typeof event.seats === 'string'
//         ? JSON.parse(event.seats)
//         : event.seats;

//         const eventTickets: EventTicketDetail[] = typeof event.ticket_details === 'string'
//         ? JSON.parse(event.ticket_details)
//         : event.ticket_details;

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