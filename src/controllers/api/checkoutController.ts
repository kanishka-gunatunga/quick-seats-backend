import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';
import transporter from '../../services/mailTransporter';
import ejs from 'ejs';
import path from 'path';
import crypto from 'crypto';

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
interface CybersourceParams {
    access_key: string;
    profile_id: string;
    transaction_uuid: string;
    signed_field_names: string;
    unsigned_field_names: string; // Usually empty if unused
    signed_date_time: string;
    locale: string;
    transaction_type: string;
    reference_number: string;
    amount: string;
    currency: string;
    signature?: string;
    [key: string]: any; 
}

function uniqId(prefix = '', more_entropy = false) {
    const now = Date.now();
    const sec = Math.floor(now / 1000).toString(16);
    const usec = ((now % 1000) * 1000).toString().padStart(5, '0');
    return prefix + sec + usec;
}
function signCybersourceParams(params: CybersourceParams, secretKey: string): string {
    const signedFieldNames = params.signed_field_names!.split(',');
    const dataToSign = signedFieldNames.map(field => `${field}=${params[field] ?? ''}`).join(',');

    return crypto.createHmac('sha256', secretKey).update(dataToSign).digest('base64');
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
        seat_ids = [],
        tickets_without_seats = [],
    } = result.data;

    if (seat_ids.length === 0 && tickets_without_seats.length === 0) {
        return res.status(400).json({ message: 'No seats or tickets without seats provided for checkout.' });
    }

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

        const eventSeats: Seat[] = typeof event.seats === 'string'
            ? JSON.parse(event.seats)
            : event.seats || [];

        const eventTicketDetails: any[] = typeof event.ticket_details === 'string'
            ? JSON.parse(event.ticket_details)
            : event.ticket_details || [];

        let subTotal = 0;

        // Validate and calculate total for seat-based tickets
        for (const seatId of seat_ids) {
            const foundSeat: Seat | undefined = eventSeats.find((seat: Seat) => seat.seatId.toString() === seatId.toString());

            if (!foundSeat) {
                return res.status(400).json({ message: `Seat ${seatId} not found or invalid for this event.` });
            }
            if (foundSeat.status !== 'available') {
                return res.status(400).json({ message: `Seat ${seatId} is already ${foundSeat.status}.` });
            }
            subTotal += foundSeat.price;
        }

        // Validate and calculate total for tickets without seats
        const updatedTicketDetails = JSON.parse(JSON.stringify(eventTicketDetails)); // Deep copy to avoid modifying original
        for (const ticket of tickets_without_seats) {
            const ticketDetailIndex = updatedTicketDetails.findIndex((td: any) => td.ticketTypeId === ticket.ticket_type_id);

            if (ticketDetailIndex === -1) {
                return res.status(400).json({ message: `Ticket type ID ${ticket.ticket_type_id} not found for this event.` });
            }

            const currentTicketDetail = updatedTicketDetails[ticketDetailIndex];

            if (currentTicketDetail.hasTicketCount && currentTicketDetail.ticketCount !== null) {
                if (((currentTicketDetail.bookedTicketCount || 0) + ticket.ticket_count) > currentTicketDetail.ticketCount) {
                    return res.status(400).json({
                        message: `Not enough tickets available for ticket type ID ${ticket.ticket_type_id}. Available: ${currentTicketDetail.ticketCount - (currentTicketDetail.bookedTicketCount || 0)}. Requested: ${ticket.ticket_count}.`
                    });
                }
            }
            subTotal += currentTicketDetail.price * ticket.ticket_count;
        }

        // Generate a unique transaction UUID for Cybersource
        const transactionUuid = uniqId();

        // Create the order in a 'pending' state
        const ticketsWithoutSeatsForOrder = tickets_without_seats.map(ticket => ({
            ...ticket,
            issued_count: 0, // Initially no tickets issued
        }));

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
                seat_ids: seat_ids.length > 0 ? JSON.stringify(seat_ids) : '[]',
                tickets_without_seats: ticketsWithoutSeatsForOrder.length > 0 ? JSON.stringify(ticketsWithoutSeatsForOrder) : '[]',
                sub_total: subTotal,
                discount: 0,
                total: subTotal,
                status: 'pending', // Order status is pending until payment confirmation
                cybersource_transaction_uuid: transactionUuid, // Store the UUID for lookup in callback
            },
        });

        // Prepare parameters for Cybersource Hosted Checkout
        const CYBERSOURCE_ACCESS_KEY = process.env.CYBERSOURCE_ACCESS_KEY as string;
        const CYBERSOURCE_SECRET_KEY = process.env.CYBERSOURCE_SECRET_KEY as string;
        const CYBERSOURCE_PROFILE_ID = process.env.CYBERSOURCE_PROFILE_ID as string;
        const CYBERSOURCE_SECURE_ACCEPTANCE_URL = process.env.CYBERSOURCE_SECURE_ACCEPTANCE_URL as string;
        const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL as string;
        const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL as string; // You'll need to define this in your .env

        const signedFieldNames = [
            'access_key',
            'profile_id',
            'transaction_uuid',
            'signed_field_names',
            'unsigned_field_names',
            'signed_date_time',
            'locale',
            'transaction_type',
            'reference_number',
            'amount',
            'currency'
        ].join(',');

        const paramsForCybersource: CybersourceParams = {
            access_key: CYBERSOURCE_ACCESS_KEY,
            profile_id: CYBERSOURCE_PROFILE_ID,
            transaction_uuid: uniqId(), // emulate PHP's uniqid()
            signed_field_names: signedFieldNames,
            unsigned_field_names: '', // leave blank if you’re not sending any unsigned fields
            signed_date_time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            locale: 'en',
            transaction_type: 'sale', // or 'authorization' based on your flow
            reference_number: order.id.toString(),
            amount: subTotal.toFixed(2),
            currency: 'LKR',
        };

        // Generate the signature
        paramsForCybersource.signature = signCybersourceParams(paramsForCybersource, CYBERSOURCE_SECRET_KEY);


        // Respond to the frontend with the redirect URL and parameters
        return res.status(200).json({
            message: 'Proceed to payment gateway',
            redirectUrl: CYBERSOURCE_SECURE_ACCEPTANCE_URL,
            params: paramsForCybersource,
            order_id: order.id, // Return order ID for frontend reference
        });

    } catch (err) {
        console.error('Checkout error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

async function generateQRCodesAndAttachments(order: any, event: any, seatDetailsMap: any, groupedSeats: any, ticketsWithoutSeatsDetails: any) {
    const qrCodes: { ticketTypeName: string; count: number; qrCodeData: string; type_id: number; seat_ids_for_type?: string[]; type: 'seat' | 'no seat' }[] = [];
    const attachments: any[] = [];

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
                type: "seat",
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
            type: "no seat",
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

    qrCodes.forEach((qr, index) => {
        attachments.push({
            filename: `ticket-${qr.ticketTypeName}-${qr.type}-${index + 1}.png`,
            content: qr.qrCodeData.split("base64,")[1],
            encoding: 'base64',
            cid: `qr${index}@event.com`,
        });
    });

    return { qrCodes, attachments };
}


async function sendQREmail(email: string, first_name: string, event_name: string, all_booked_details: string, qrCodes: any[], attachments: any[]) {
    const templatePath = path.join(__dirname, '../../views/email-templates/qr-template.ejs');
    const qrEmailHtml = await ejs.renderFile(templatePath, {
        first_name: first_name,
        event_name: event_name,
        booked_seats_details: all_booked_details,
        qrCodes: qrCodes,
    });

    await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to: email,
        subject: 'Your Event QR Tickets',
        html: qrEmailHtml,
        attachments: attachments,
    });
}


export const cybersourceCallback = async (req: Request, res: Response) => {
    const callbackData = req.body;
    console.log('Cybersource Callback Received:', callbackData);

    const CYBERSOURCE_SECRET_KEY = process.env.CYBERSOURCE_SECRET_KEY as string;

    // IMPORTANT: Verify the signature of the callback data
    const receivedSignature = callbackData.signature;
    const signedFieldNames = callbackData.signed_field_names;

    const callbackParams: { [key: string]: any } = {};
    if (signedFieldNames) {
        signedFieldNames.split(',').forEach((field: string) => {
            if (callbackData[field] !== undefined) {
                callbackParams[field] = callbackData[field];
            }
        });
    } else {
        // Fallback: If signed_field_names is somehow missing, include all relevant fields
        // This is less secure; ensure signed_field_names is always present in Cybersource configuration
        for (const key in callbackData) {
            if (key !== 'signature' && key !== 'signed_field_names') {
                callbackParams[key] = callbackData[key];
            }
        }
    }

    const expectedSignature = signCybersourceParams(callbackParams, CYBERSOURCE_SECRET_KEY);

    if (receivedSignature !== expectedSignature) {
        console.error('Cybersource Callback Signature Verification FAILED!');
        // Respond with 403 Forbidden if signature verification fails
        return res.status(403).send('Signature verification failed.');
    }

    console.log('Cybersource Callback Signature Verified Successfully!');

    const {
        req_reference_number: orderId, // This is your internal order.id
        transaction_uuid: cybersourceTransactionUuid, // Cybersource's UUID
        decision, // e.g., 'ACCEPT', 'DECLINE', 'REVIEW'
        reason_code: reasonCode,
        auth_amount: amount,
        auth_currency: currency,
        // Add other fields you might need from the callback
    } = callbackData;

    try {
        const order = await prisma.order.findUnique({
            where: {
                id: parseInt(orderId),
                cybersource_transaction_uuid: cybersourceTransactionUuid,
            },
        });

        if (!order) {
            console.error(`Order with ID ${orderId} and UUID ${cybersourceTransactionUuid} not found.`);
            return res.status(404).send('Order not found.');
        }

        // Prevent reprocessing if the order is already completed or failed
        if (order.status === 'completed' || order.status === 'failed') {
            console.warn(`Callback received for order ${order.id} which is already ${order.status}. Ignoring.`);
            return res.status(200).send('Order already processed.');
        }

        if (decision === 'ACCEPT') {
            console.log(`Payment for Order ID ${order.id} (Cybersource UUID: ${cybersourceTransactionUuid}) was SUCCESSFUL.`);

            // Update order status to 'completed'
            await prisma.order.update({
                where: { id: order.id },
                data: { status: 'completed' },
            });

            // Retrieve event details to update seats and ticket counts
            const event = await prisma.event.findUnique({
                where: { id: parseInt(order.event_id) },
                select: {
                    name: true,
                    seats: true,
                    ticket_details: true,
                },
            });

            if (!event) {
                console.error(`Event ${order.event_id} not found for order ${order.id}. Cannot update seats/tickets.`);
                // Still acknowledge Cybersource, but log the error
                return res.status(200).send('Payment processed, but event details missing for fulfillment.');
            }

             const eventSeats: Seat[] = typeof event.seats === 'string'
            ? JSON.parse(event.seats)
            : event.seats || []; // Ensure it's an array

            const eventTicketDetails: any[] = typeof event.ticket_details === 'string'
            ? JSON.parse(event.ticket_details)
            : event.ticket_details || []; // Ensure it's an array

            let orderSeatIds: string[] = [];
            if (order.seat_ids !== null) {
                try {
                    const parsedSeatIds = JSON.parse(order.seat_ids as string); 
                    if (Array.isArray(parsedSeatIds)) {
                        orderSeatIds = parsedSeatIds.map((id: any) => String(id));
                    }
                } catch (e) {
                    console.error("Failed to parse order.seat_ids:", e);
                }
            }

            let orderTicketsWithoutSeats: TicketWithoutSeat[] = [];
            if (order.tickets_without_seats !== null) {
                try {
                    const parsedTickets = JSON.parse(order.tickets_without_seats as string); 
                    if (Array.isArray(parsedTickets) && parsedTickets.every((item: any) =>
                        typeof item === 'object' && 'ticket_type_id' in item && 'ticket_count' in item
                    )) {
                        orderTicketsWithoutSeats = parsedTickets;
                    }
                } catch (e) {
                    console.error("Failed to parse order.tickets_without_seats:", e);
                }
            }

            const groupedSeats: { [ticketTypeName: string]: string[] } = {};
            const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};

            // Process seat-based tickets for QR code generation
            for (const seatId of orderSeatIds) {
                const foundSeat: Seat | undefined = eventSeats.find((seat: Seat) => seat.seatId.toString() === seatId.toString());
                if (foundSeat) {
                    const ticketTypeName = foundSeat.ticketTypeName;
                    if (!groupedSeats[ticketTypeName]) {
                        groupedSeats[ticketTypeName] = [];
                    }
                    groupedSeats[ticketTypeName].push(seatId.toString());
                    seatDetailsMap[seatId.toString()] = { price: foundSeat.price, ticketTypeName: foundSeat.ticketTypeName, type_id: foundSeat.type_id };
                }
            }

            // Process tickets without seats for QR code generation and update counts
            const ticketsWithoutSeatsDetails: { ticketTypeName: string; count: number; type_id: number; price: number }[] = [];
            const updatedEventTicketDetails = JSON.parse(JSON.stringify(eventTicketDetails)); // Deep copy for modification

            for (const ticket of orderTicketsWithoutSeats) {
                const ticketDetailIndex = updatedEventTicketDetails.findIndex((td: any) => td.ticketTypeId === ticket.ticket_type_id);
                if (ticketDetailIndex !== -1) {
                    const currentTicketDetail = updatedEventTicketDetails[ticketDetailIndex];
                    currentTicketDetail.bookedTicketCount = (currentTicketDetail.bookedTicketCount || 0) + ticket.ticket_count;

                    const ticket_type = await prisma.ticketType.findUnique({
                        where: { id: parseInt(currentTicketDetail.ticketTypeId) },
                        select: { name: true },
                    });

                    ticketsWithoutSeatsDetails.push({
                        ticketTypeName: ticket_type?.name || `Type ${ticket.ticket_type_id}`,
                        count: ticket.ticket_count,
                        type_id: ticket.ticket_type_id,
                        price: currentTicketDetail.price,
                    });
                }
            }

            // Update event seats and ticket_details
            const updatedSeats = eventSeats.map((seat: Seat) => {
                if (orderSeatIds.includes(seat.seatId.toString())) {
                    return { ...seat, status: 'booked' };
                }
                return seat;
            });

            await prisma.event.update({
                where: { id: parseInt(order.event_id) },
                data: {
                    seats: JSON.stringify(updatedSeats),
                    ticket_details: JSON.stringify(updatedEventTicketDetails),
                },
            });

            // Generate QR codes and attachments
            const { qrCodes, attachments } = await generateQRCodesAndAttachments(order, event, seatDetailsMap, groupedSeats, ticketsWithoutSeatsDetails);

            // Prepare email content
            const booked_seats_details = Object.keys(groupedSeats).map(ticketTypeName => {
                const seats = groupedSeats[ticketTypeName];
                return `${ticketTypeName}: ${seats.join(', ')}`;
            }).join('; ');

            const booked_tickets_without_seats_details = ticketsWithoutSeatsDetails.map(ticket => {
                return `${ticket.ticketTypeName} (No Seat): ${ticket.count} tickets`;
            }).join('; ');

            const all_booked_details = [booked_seats_details, booked_tickets_without_seats_details].filter(Boolean).join('; ');

            // Send email
            await sendQREmail(order.email, order.first_name, event.name, all_booked_details, qrCodes, attachments);

            // Respond to Cybersource (important for acknowledging the callback)
            res.status(200).send('Payment successful and order fulfilled.');

        } else {
            await prisma.order.update({
                where: { id: order.id },
                data: { status: 'failed' },
            });
            res.status(200).send('Payment failed, order status updated.');
        } 

    } catch (err) {
        console.error('Cybersource callback processing error:', err);

        res.status(200).send('Internal server error during callback processing.');
    }
};
