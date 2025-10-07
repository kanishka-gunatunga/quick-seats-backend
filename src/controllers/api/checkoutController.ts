import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';
import transporter from '../../services/mailTransporter';
import ejs from 'ejs';
import path from 'path';
import crypto from 'crypto';
import { put } from '@vercel/blob';
import axios from 'axios';
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
  unsigned_field_names: string; // Usually empty
  signed_date_time: string;
  locale: string;
  transaction_type: string;
  reference_number: string;
  amount: string;
  currency: string;
  bill_to_email: string;
  bill_to_forename: string;
  bill_to_surname: string;
  bill_to_phone: string;
  bill_to_address_country: string;
  bill_to_address_line1: string;
  bill_to_address_city: string;
  signature?: string;
  [key: string]: any; // for any additional dynamic fields if needed
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
        country: z.string().min(1, 'Address is required'),
        address: z.string().min(1, 'City is required'),
        city: z.string().min(1, 'Country is required'),
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
        address,
        city,
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
           if (foundSeat.status !== 'available' && foundSeat.status !== 'pending') {
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
                address,
                city,
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
            'currency',
            'bill_to_email',
            'bill_to_forename',
            'bill_to_surname',
            'bill_to_phone',
            'bill_to_address_country',
            'bill_to_address_line1',
            'bill_to_address_city'
        ].join(',');

        const paramsForCybersource: CybersourceParams = {
            access_key: CYBERSOURCE_ACCESS_KEY,
            profile_id: CYBERSOURCE_PROFILE_ID,
            transaction_uuid: transactionUuid, 
            signed_field_names: signedFieldNames,
            unsigned_field_names: '', 
            signed_date_time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            locale: 'en',
            transaction_type: 'sale', 
            reference_number: order.id.toString(),
            amount: subTotal.toFixed(2),
            currency: 'LKR',
            bill_to_email: email,
            bill_to_forename: first_name,
            bill_to_surname: last_name,
            bill_to_phone: contact_number,
            bill_to_address_country: country,
            bill_to_address_line1: address,
            bill_to_address_city: city,
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


async function sendQREmail(email: string, first_name: string, event_name: string, all_booked_details: string, qrCodes: any[], attachments: any[],orderId: number) {
    const templatePath = path.join(__dirname, '../../views/email-templates/qr-template.ejs');
    const qrEmailHtml = await ejs.renderFile(templatePath, {
        first_name: first_name,
        event_name: event_name,
        booked_seats_details: all_booked_details,
        qrCodes: qrCodes,
        order_id: orderId,
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
        req_transaction_uuid: cybersourceTransactionUuid, // Cybersource's UUID
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
            const uploadedQrUrls: { filename: string; url: string }[] = [];
            for (const qrCode of qrCodes) {
                // Extract base64 data from the data URL
                const base64Data = qrCode.qrCodeData.split("base64,")[1];
                const buffer = Buffer.from(base64Data, 'base64');

                const filename = `qr-${order.id}-${qrCode.ticketTypeName.replace(/\s+/g, '-')}-${qrCode.type}-${qrCode.seat_ids_for_type ? qrCode.seat_ids_for_type.join('-') : qrCode.type_id}.png`;

                try {
                    const { url } = await put(filename, buffer, {
                        access: 'public', // Set to 'public' if QR codes should be accessible via URL
                        addRandomSuffix: true, // Recommended to avoid filename collisions, especially with dynamic names
                    });
                    uploadedQrUrls.push({ filename, url });
                    console.log(`Uploaded QR code ${filename} to Vercel Blob: ${url}`);
                } catch (blobError) {
                    console.error(`Failed to upload QR code ${filename} to Vercel Blob:`, blobError);
                }
            }
             await prisma.order.update({
                where: { id: order.id },
                data: { status: 'completed',qr_code_urls: JSON.stringify(uploadedQrUrls) },
            });
            // Prepare email content
            const booked_seats_details = Object.keys(groupedSeats).map(ticketTypeName => {
                const seats = groupedSeats[ticketTypeName];
                return `${ticketTypeName}: ${seats.join(', ')}`;
            }).join('; ');

            const booked_tickets_without_seats_details = ticketsWithoutSeatsDetails.map(ticket => {
                return `${ticket.ticketTypeName} (No Seat): ${ticket.count} tickets`;
            }).join('; ');

            const all_booked_details = [booked_seats_details, booked_tickets_without_seats_details].filter(Boolean).join('; ');
            let orderInfoUrl = '';
            const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://your-nextjs-frontend.com'; // Make this configurable

            orderInfoUrl = `${FRONTEND_BASE_URL}order-info?identifier=${order.cybersource_transaction_uuid}`;

            const smsApiUrl = 'https://msmsenterpriseapi.mobitel.lk/EnterpriseSMSV3/esmsproxyURL.php';
            const smsUsername = process.env.SMS_API_USERNAME; // Store in environment variables
            const smsPassword = process.env.SMS_API_PASSWORD; // Store in environment variables
            const smsAlias = process.env.SMS_API_ALIAS; // Store in environment variables, provide a default or make it mandatory
            console.log('smsAlias',smsAlias); 
            if (!smsUsername || !smsPassword) {
            console.warn('SMS API credentials not fully configured. OTP will only be sent via email.');
            } else {
            try {
                const smsResponse = await axios.post(
                smsApiUrl,
                {
                    username: smsUsername,
                    password: smsPassword,
                    from: smsAlias,
                    to: order.contact_number, // Use the contact_number from registration
                    text: `Your booking has been successfully completed. You can view your order details here: ${orderInfoUrl}`,
                    mesageType: 1, // Promotional message type as per documentation
                },
                {
                    headers: {
                    'Content-Type': 'application/json',
                    },
                }
                );

                // You might want to log the SMS API response for debugging
                console.log('SMS API Response:', smsResponse.data);

                // Check SMS response for success (e.g., status 200)
                if (smsResponse.status !== 200) {
                console.error(`Failed to send SMS OTP. Status: ${smsResponse.status}, Data:`, smsResponse.data);
                // Decide whether to return an error or continue registration
                }
            } catch (smsError) {
                console.error('Error sending SMS OTP:', smsError);
                // Decide whether to return an error or continue registration
            }
            }
            // --- End Send OTP via SMS ---
            // Send email
            await sendQREmail(order.email, order.first_name, event.name, all_booked_details, qrCodes, attachments, order.id);
            
            // Respond to Cybersource (important for acknowledging the callback)
            res.status(200).send('Payment successful and order fulfilled.');

        } else {

            await prisma.order.update({
                where: { id: order.id },
                data: { status: 'failed' },
            });

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
            : event.seats || [];

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

            const groupedSeats: { [ticketTypeName: string]: string[] } = {};
            const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};


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

            const updatedSeats = eventSeats.map((seat: Seat) => {
                if (orderSeatIds.includes(seat.seatId.toString())) {
                    return { ...seat, status: 'available' };
                }
                return seat;
            });

             await prisma.event.update({
                where: { id: parseInt(order.event_id) },
                data: {
                    seats: JSON.stringify(updatedSeats)
                },
            });

            res.status(200).send('Payment failed, order status updated.');
        } 

    } catch (err) {
        console.error('Cybersource callback processing error:', err);

        res.status(200).send('Internal server error during callback processing.');
    }
};

export const getCheckoutStatus = async (req: Request, res: Response) => {
    const schema = z.object({
        order_id: z.string().min(1, 'Order ID is required'),
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        return res.status(400).json({
            message: 'Invalid input',
            errors: result.error.flatten(),
        });
    }

    const {
        order_id,
    } = result.data;

    const order = await prisma.order.findUnique({
        where: {
            id: parseInt(order_id),
        },
    });

    if (!order) {
        console.error(`Order with ID ${order_id} not found.`);
        return res.status(404).send('Order not found.');
    }

    const event = await prisma.event.findUnique({
        where: { id: parseInt(order.event_id) },
        select: {
            name: true,
            seats: true, // Needed to retrieve seat details for the order
            ticket_details: true, // Needed to retrieve ticket type details (e.g., price, name)
        },
    });

    if (!event) {
        console.error(`Event ${order.event_id} not found for order ${order.id}.`);
        return res.status(404).send('Event details missing.');
    }

    // Safely parse event seats
    const eventSeats: Seat[] = typeof event.seats === 'string'
        ? JSON.parse(event.seats)
        : event.seats || [];

    // Safely parse event ticket details
    const eventTicketDetails: any[] = typeof event.ticket_details === 'string'
        ? JSON.parse(event.ticket_details)
        : event.ticket_details || [];

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

    // Group seats by ticket type for easier processing and display
    const groupedSeats: { [ticketTypeName: string]: string[] } = {};
    const seatDetailsMap: { [seatId: string]: { price: number; ticketTypeName: string; type_id: number } } = {};

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

    // Prepare details for tickets without seats
    const ticketsWithoutSeatsDetails: { ticketTypeName: string; count: number; type_id: number; price: number }[] = [];

    for (const ticket of orderTicketsWithoutSeats) {
        const ticketDetail = eventTicketDetails.find((td: any) => td.ticketTypeId === ticket.ticket_type_id);
        if (ticketDetail) {
            // Fetch ticket type name from DB or use a fallback
            const ticket_type = await prisma.ticketType.findUnique({
                where: { id: parseInt(ticketDetail.ticketTypeId) },
                select: { name: true },
            });

            ticketsWithoutSeatsDetails.push({
                ticketTypeName: ticket_type?.name || `Type ${ticket.ticket_type_id}`,
                count: ticket.ticket_count,
                type_id: ticket.ticket_type_id,
                price: ticketDetail.price,
            });
        }
    }

    // Call your existing generateQRCodesAndAttachments function
    // We only need 'qrCodes' for the downloadable response
    const { qrCodes } = await generateQRCodesAndAttachments(order, event, seatDetailsMap, groupedSeats, ticketsWithoutSeatsDetails);

    // Prepare the final response object for the customer
    const responseDetails = {
        message: 'Your payment was successful! Here are your order details and QR codes.',
        customer: {
            firstName: order.first_name,
            lastName: order.last_name,
            email: order.email,
            contact_number: order.contact_number,
        },
        event: {
            name: event.name,
        },
        bookedTickets: {
            // Structured for clarity in the summary
            seats: Object.keys(groupedSeats).map(ticketTypeName => ({
                ticketTypeName: ticketTypeName,
                seatIds: groupedSeats[ticketTypeName],
                // Include price and type_id for each seat if needed in the summary
                seatDetails: groupedSeats[ticketTypeName].map(seatId => ({
                    seatId: seatId,
                    price: seatDetailsMap[seatId]?.price,
                    type_id: seatDetailsMap[seatId]?.type_id,
                }))
            })),
            ticketsWithoutSeats: ticketsWithoutSeatsDetails,
        },
        orderId: order.id,
        orderTotal: order.total,
        // Map the qrCodeData (data URLs) from the qrCodes array for direct consumption
        qrCodesDataUrls: qrCodes.map(qr => qr.qrCodeData),
    };

    // Set the content type to application/json
    res.setHeader('Content-Type', 'application/json');

    // If you want to force the browser to download this JSON response as a file:
    // res.setHeader('Content-Disposition', `attachment; filename="order_summary_${order.id}.json"`);

    // Send the JSON response
    return res.status(200).json(responseDetails);
};




export const checkoutClientRedirect = async (req: Request, res: Response) => {
    const callbackData = req.body;
    console.log('Cybersource Browser POST Callback Received:', callbackData); 

    const CYBERSOURCE_SECRET_KEY = process.env.CYBERSOURCE_SECRET_KEY as string;


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
        console.warn('signed_field_names missing from Cybersource browser callback. Processing all fields for signature verification. This is not recommended for production.');
        for (const key in callbackData) {
            if (key !== 'signature' && key !== 'signed_field_names') {
                callbackParams[key] = callbackData[key];
            }
        }
    }

    const expectedSignature = signCybersourceParams(callbackParams, CYBERSOURCE_SECRET_KEY);

    if (receivedSignature !== expectedSignature) {
        console.error('Cybersource Browser Callback Signature Verification FAILED!');
        console.error('Received Signature:', receivedSignature);
        console.error('Expected Signature:', expectedSignature);
        // Respond with 403 Forbidden if signature verification fails
        // Important: A 403 will likely be displayed to the user by their browser.
        // You might consider redirecting to a generic error page instead of a 403 for better UX.
        return res.status(403).send('Signature verification failed.');
    }

    console.log('Cybersource Browser Callback Signature Verified Successfully!');

    // Extract relevant data from the callback
    const {
        req_reference_number: orderId, // Your internal order ID
        decision, // 'ACCEPT', 'DECLINE', 'REVIEW', 'ERROR'
        reason_code: reasonCode, // More granular reason for the decision
        // Add any other fields you want to pass to the frontend
    } = callbackData;

    // Construct the frontend redirect URL
    let frontendRedirectUrl = '';
    const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://your-nextjs-frontend.com'; // Make this configurable

    if (decision === 'ACCEPT') {
        frontendRedirectUrl = `${FRONTEND_BASE_URL}/order-status?status=200&orderId=${orderId}`;
    } else {
        // For 'DECLINE', 'REVIEW', 'ERROR', or any other non-ACCEPT decision
        frontendRedirectUrl = `${FRONTEND_BASE_URL}/order-status?status=403&orderId=${orderId}&reasonCode=${reasonCode || 'UNKNOWN'}`;
    }

    // Perform the HTTP 302 redirect to the frontend
    console.log(`Redirecting user to frontend: ${frontendRedirectUrl}`);
    res.redirect(302, frontendRedirectUrl);
};

export const checkoutClientCancel = async (req: Request, res: Response) => {
    // Log the received callback data for debugging.
    console.log('Cybersource Browser CANCEL Callback Received:', req.body);

    // Extract the order ID from the callback data.
    // Cybersource typically sends back the same fields you passed in the initial request.
    const {
        req_reference_number: orderId, // Your internal order ID
    } = req.body;

    // Define the base URL for your frontend.
    const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://your-nextjs-frontend.com';

    // Construct the frontend redirect URL for the cancellation page.
    // Use a status code like 400 (Bad Request) or 409 (Conflict) to indicate a cancellation.
    // You can customize the status and parameters as needed for your frontend logic.
    const frontendRedirectUrl = `${FRONTEND_BASE_URL}/order-status?status=409&orderId=${orderId}`;

    // Perform the HTTP 302 redirect to the frontend.
    console.log(`Redirecting user to frontend cancel page: ${frontendRedirectUrl}`);
    res.redirect(302, frontendRedirectUrl);
};