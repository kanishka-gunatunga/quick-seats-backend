import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import slugify from 'slugify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { put } from '@vercel/blob';
import upload from '../../middlewares/upload';
import { del } from '@vercel/blob';
import QRCode from 'qrcode';
import transporter from '../../services/mailTransporter';
import ejs from 'ejs';
import path from 'path';

const prisma = new PrismaClient();


export const addBookingGet = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  const events = await prisma.event.findMany({where: { status:'active' } });
  const customers = await prisma.userDetails.findMany({});

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('booking/add-booking', {
    error,
    success,
    formData,
    validationErrors,
    events,
    customers,
  });
};

export const getCustomerDetails = async (req: Request, res: Response) => {
  const customerId = req.params.id;

  if (customerId === 'guest') {
    return res.json({}); 
  }

  try {
    const customer = await prisma.user.findUnique({
    where: { id: Number(customerId) },
    include: { userDetails: true },
    });

    if (customer) {
      res.json(customer);
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
    
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getTicketsWithoutSeats = async (req: Request, res: Response) => {
  const eventId = req.params.id;

  try {
    const event = await prisma.event.findUnique({
      where: {
        id: parseInt(eventId),
      },
      select: {
        ticket_details: true, // Select the ticket_details JSON string
      },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Parse the ticket_details JSON string from the event
    // Ensure it's an array, default to empty array if null or parsing fails
    let allTicketDetails: any[] = [];
    if (event.ticket_details) {
      try {
        allTicketDetails = JSON.parse(event.ticket_details as string);
        if (!Array.isArray(allTicketDetails)) {
          console.warn("event.ticket_details parsed but is not an array:", allTicketDetails);
          allTicketDetails = [];
        }
      } catch (parseError) {
        console.error("Error parsing event.ticket_details JSON:", parseError);
        allTicketDetails = [];
      }
    }

    // Filter for ticket types that are designated as 'tickets without seats'
    // These are the ones where hasTicketCount is true
    const ticketsWithoutSeatsConfig = allTicketDetails.filter(
      (ticket: any) => ticket.hasTicketCount === true
    );

    if (ticketsWithoutSeatsConfig.length === 0) {
      // If no ticket types with hasTicketCount: true, return an empty array
      return res.json([]);
    }

    // Extract unique ticket type IDs from the filtered configuration
    const uniqueTicketTypeIds = [
      ...new Set(ticketsWithoutSeatsConfig.map((ticket: any) => ticket.ticketTypeId))
    ].filter(id => id !== undefined && id !== null); // Filter out any undefined/null IDs

    // Fetch the actual ticket type names from the TicketType model
    const ticketTypes = await prisma.ticketType.findMany({
      where: {
        id: { in: uniqueTicketTypeIds },
      },
      select: {
        id: true,
        name: true,
      },
    });

    // Create a map for quick lookup of ticket type names
    const ticketTypeNameMap = new Map(ticketTypes.map(tt => [tt.id, tt.name]));

    // Prepare the final response data for tickets without seats
    const ticketsWithoutSeatsResponse = ticketsWithoutSeatsConfig.map((ticket: any) => {
      const totalConfiguredCount = ticket.ticketCount || 0;
      // Get the booked count from the parsed ticket_details
      const currentlyBookedCount = ticket.bookedTicketCount || 0; 
      
      const availableCount = totalConfiguredCount - currentlyBookedCount;

      return {
        ticket_type_id: ticket.ticketTypeId,
        ticket_type_name: ticketTypeNameMap.get(ticket.ticketTypeId) || 'Unknown Ticket Type',
        // Ensure available_count is not negative
        available_count: Math.max(0, availableCount), 
        price: ticket.price,
      };
    });

    res.json(ticketsWithoutSeatsResponse);

  } catch (error) {
    console.error('Error fetching tickets without seats:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

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

export const addBookingPost = async (req: Request, res: Response) => {
    const schema = z.object({
        first_name: z.string().min(1, 'First name is required'),
        last_name: z.string().min(1, 'Last name is required'),
        contact_number: z.string().min(1, 'Contact number is required'),
        email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
        nic_passport: z.string().min(1, 'NIC/Passport is required'),
        country: z.string().min(1, 'Country is required'),
        event_id: z.string().min(1, 'Event id is required'),
        customer: z.string().min(1, 'Customer is required'),
        selected_seats: z.preprocess((val) => {
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
        const errors = result.error.flatten().fieldErrors;
        req.session.error = 'Please fix the errors below.';
        req.session.formData = req.body;
        req.session.validationErrors = errors;
        return res.redirect('/add-booking');
    }

    const {
        email,
        first_name,
        last_name,
        contact_number,
        nic_passport,
        country,
        event_id,
        customer,
        selected_seats = [], // Default to empty array if not provided
        tickets_without_seats = [], // Default to empty array if not provided
    } = result.data;

    console.log('tickets_without_seats', tickets_without_seats); // This should now show the parsed array
    if (selected_seats.length === 0 && tickets_without_seats.length === 0) {
        req.session.error = 'No seats or tickets without seats provided for booking.';
        req.session.formData = req.body;
        return res.redirect('/add-booking');
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
            req.session.error = 'Event not found.';
            req.session.formData = req.body;
            return res.redirect('/add-booking');
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
        for (const seatId of selected_seats) {
            const foundSeat: Seat | undefined = eventSeats.find((seat: Seat) => seat.seatId.toString() === seatId.toString());

            if (!foundSeat) {
                req.session.error = `Seat ${seatId} not found or invalid for this event.`;
                req.session.formData = req.body;
                return res.redirect('/add-booking');
            }
            if (foundSeat.status !== 'available') {
                req.session.error = `Seat ${seatId} is already ${foundSeat.status}.`;
                req.session.formData = req.body;
                return res.redirect('/add-booking');
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
                req.session.error = `Ticket type ID ${ticket.ticket_type_id} not found for this event.`;
                req.session.formData = req.body;
                return res.redirect('/add-booking');
            }

            const currentTicketDetail = updatedTicketDetails[ticketDetailIndex];

            // Check if hasTicketCount is true and if there's enough available
            if (currentTicketDetail.hasTicketCount && currentTicketDetail.ticketCount !== null) {
                if (((currentTicketDetail.bookedTicketCount || 0) + ticket.ticket_count) > currentTicketDetail.ticketCount) {
                  req.session.error = `Not enough tickets available for ticket type ID ${ticket.ticket_type_id}. Available: ${currentTicketDetail.ticketCount - (currentTicketDetail.bookedTicketCount || 0)}. Requested: ${ticket.ticket_count}.`;
                  req.session.formData = req.body;
                  return res.redirect('/add-booking');
                }
            }
            // Ensure bookedTicketCount is initialized if it's undefined or null
            currentTicketDetail.bookedTicketCount = (currentTicketDetail.bookedTicketCount || 0) + ticket.ticket_count;
            subTotal += currentTicketDetail.price * ticket.ticket_count;
            const ticket_type = await prisma.ticketType.findUnique({
                where: { id: parseInt(currentTicketDetail.ticketTypeId) },
                select: {
                    name: true
                },
            });
            if (!ticket_type) {

                console.warn(`TicketType with ID ${ticket.ticket_type_id} not found in database.`);
                req.session.error =`Ticket type details not found for ID: ${ticket.ticket_type_id}.` ;
                req.session.formData = req.body;
                return res.redirect('/add-booking');
            }
            ticketsWithoutSeatsDetails.push({
                ticketTypeName: ticket_type.name || '', 
                count: ticket.ticket_count,
                type_id: ticket.ticket_type_id,
                price: currentTicketDetail.price,
            });
        }

        const ticketsWithoutSeatsForOrder = tickets_without_seats.map(ticket => ({
            ...ticket,
            issued_count: 0,
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
                user_id: customer,
                seat_ids: selected_seats.length > 0 ? JSON.stringify(selected_seats) : '[]', 
                tickets_without_seats: ticketsWithoutSeatsForOrder.length > 0 ? JSON.stringify(ticketsWithoutSeatsForOrder) : '[]',
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
            if (selected_seats.map(String).includes(seat.seatId.toString())) {
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

        req.session.success = 'Booking added successfully!';
        req.session.formData = {};
        req.session.validationErrors = {};
        return res.redirect('/add-booking');
    } catch (err) {
        console.error('Error adding event:', err);
        req.session.error = 'An unexpected error occurred while adding the event.';
        req.session.formData = req.body;
        return res.redirect('/add-booking');
        
    }
};
export const bookings = async (req: Request, res: Response) => {
  const selectedStatus = req.query.status as string; // Cast to string

  let orders;

  if (selectedStatus && selectedStatus !== 'all') {
    orders = await prisma.order.findMany({
      where: {
        status: selectedStatus,
      },
    });
  } else {
    orders = await prisma.order.findMany({});
  }

  const eventIds = [...new Set(orders.map(order => parseInt(order.event_id, 10)))];

  const events = await prisma.event.findMany({
    where: {
      id: {
        in: eventIds,
      },
    },
  });

  const eventMap = new Map<number, string>();
  events.forEach(event => {
    eventMap.set(event.id, event.name);
  });

  const ordersWithEventNames = orders.map(order => ({
    ...order,
    event_id: parseInt(order.event_id, 10), 
    eventName: eventMap.get(parseInt(order.event_id, 10)) || 'Unknown Event',
  }));

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('booking/bookings', {
    error,
    success,
    orders: ordersWithEventNames,
    selectedStatus: selectedStatus || 'all', 
  });
};
export const viewBooking = async (req: Request, res: Response) => {
  const order_id = req.params.id;

  try {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(order_id as string, 10) },
    });
    
    if (!order) {
      req.session.error = 'Order not found.';
      req.session.save(() => {
        return res.redirect('/bookings');
      });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: parseInt(order.event_id, 10) },
    });

    if (!event) {
      req.session.error = 'Associated event not found for this order.';
      req.session.save(() => {
        return res.redirect('/bookings');
      });
      return;
    }

    const cancells = await prisma.canceledTicket.findMany({
    where: { order_id: parseInt(order_id, 10) },
    });

    // Define a type for the aggregated ticket structure
    interface AggregatedCancel {
    type: string;
    ticketTypeName: string;
    quantity: number;
    price: number;
    seat_ids: string[];
    }

    // Aggregate the data to group by ticketTypeName
    const aggregatedCancells = cancells.reduce((acc: Record<string, AggregatedCancel>, cancel) => {
    // Ensure ticketTypeName is a string; handle cases where it might be null/undefined
    const key: string = cancel.ticketTypeName || 'Unknown Ticket Type'; // Provides a fallback if ticketTypeName is null

    if (!acc[key]) {
        acc[key] = {
        type: cancel.type,
        ticketTypeName: key,
        quantity: 0,
        price: 0,
        seat_ids: [],
        };
    }

    // Add quantity, handling nulls
    if (cancel.quantity !== null) {
        acc[key].quantity += cancel.quantity;
    } else {
        acc[key].quantity += 1;
    }

    // Add price, handling nulls
    if (cancel.price !== null) {
        acc[key].price += cancel.price;
    }

    // Collect seat IDs if it's a 'seat' type and seat_id exists
    if (cancel.type === 'seat' && cancel.seat_id) {
        acc[key].seat_ids.push(cancel.seat_id);
    }

    return acc;
    }, {} as Record<string, AggregatedCancel>); // <-- This is the key change!

    // Convert the aggregated object back to an array for easier iteration in EJS
    const finalCancells = Object.values(aggregatedCancells);

    const ticketTypes = await prisma.ticketType.findMany({});

    let ticketsWithoutSeats = order.tickets_without_seats;
    if (typeof ticketsWithoutSeats === 'string') {
      try {
        ticketsWithoutSeats = JSON.parse(ticketsWithoutSeats);
      } catch (e) {
        console.error("Failed to parse tickets_without_seats:", e);
        ticketsWithoutSeats = [];
      }
    }

    const enrichedTicketsWithoutSeats: any[] = [];
    const eventTicketDetails = typeof event.ticket_details === 'string' 
        ? JSON.parse(event.ticket_details) 
        : event.ticket_details;

    if (Array.isArray(ticketsWithoutSeats) && Array.isArray(eventTicketDetails)) {
        ticketsWithoutSeats.forEach((ticket: any) => {
            const ticketTypeId = parseInt(ticket.ticket_type_id, 10);
            const foundTicketType = ticketTypes.find(tt => tt.id === ticketTypeId);
            const foundEventTicketDetail = eventTicketDetails.find((etd: any) => etd.ticketTypeId === ticketTypeId);

            if (foundTicketType) {
                enrichedTicketsWithoutSeats.push({
                    ticket_type_id: ticketTypeId,
                    ticket_count: ticket.ticket_count,
                    issued_count: ticket.issued_count,
                    name: foundTicketType.name,
                    price: foundEventTicketDetail ? foundEventTicketDetail.price : 'N/A', // Get price from event.ticket_details
                });
            } else {
                // Handle cases where ticket type is not found (optional: log or push with default name)
                enrichedTicketsWithoutSeats.push({
                    ticket_type_id: ticketTypeId,
                    ticket_count: ticket.ticket_count,
                    issued_count: ticket.issued_count,
                    name: "Unknown Ticket Type",
                    price: 'N/A',
                });
            }
        });
    }


    let seatIds = order.seat_ids;
    if (typeof seatIds === 'string') {
      try {
        seatIds = JSON.parse(seatIds);
      } catch (e) {
        console.error("Failed to parse seat_ids:", e);
        seatIds = [];
      }
    }

    const seatsWithDetails: any[] = [];
    const eventSeats = typeof event.seats === 'string' ? JSON.parse(event.seats) : event.seats;


    const validatedSeatIds: string[] = [];
    if (Array.isArray(seatIds)) {
      seatIds.forEach((id: any) => { 
        if (typeof id === 'string') {
          validatedSeatIds.push(id);
        } else {
          console.warn(`Skipping non-string seatId: ${id}`);
        }
      });
    }

    if (Array.isArray(validatedSeatIds) && Array.isArray(eventSeats)) {
      validatedSeatIds.forEach((seatId: string) => { 
        const foundSeat = eventSeats.find((s: any) => s.seatId === seatId);
        if (foundSeat) {
          const ticketType = ticketTypes.find(tt => tt.id === foundSeat.type_id);
          seatsWithDetails.push({
            seatId: foundSeat.seatId,
            price: foundSeat.price,
            status: foundSeat.status,
            type_id: foundSeat.type_id,
            ticketTypeName: ticketType ? ticketType.name : "Unknown Type",
            color: ticketType ? ticketType.color : "#CCCCCC"
          });
        }
      });
    }
    const orderWithParsedData = {
      ...order,
      event: event,
      tickets_without_seats: enrichedTicketsWithoutSeats,
      seat_ids: seatsWithDetails,
      ticketTypes: ticketTypes, 
      cancells: finalCancells,
    };

    const error = req.session.error;
    const success = req.session.success;
    req.session.error = undefined;
    req.session.success = undefined;

    res.render('booking/view-booking', {
      error,
      success,
      order: orderWithParsedData,
    });
  } catch (err) {
    console.error("Error fetching booking details:", err);
    req.session.error = 'An error occurred while fetching booking details.';
    req.session.save(() => {
      res.redirect('/bookings');
    });
  }
};
export const cancelSeat = async (req: Request, res: Response) => {
    const order_id = req.params.id;
    const { canceledSeats: canceledSeatsString } = req.body;
    let canceledSeats: Array<{ seatId: string; type_id: string; ticketTypeName: string; price: number; color?: string }>;

    try {
        canceledSeats = JSON.parse(canceledSeatsString);
    } catch (e) {
        console.error("Failed to parse canceledSeats from request body:", e);
        req.session.error = 'Invalid seat cancellation data provided.';
        req.session.save(() => {
            return res.redirect(`/booking/view/${order_id}`);
        });
        return;
    }

    console.log('canceledSeats received from frontend:', canceledSeats);

    if (!canceledSeats || !Array.isArray(canceledSeats) || canceledSeats.length === 0) {
        req.session.error = 'No seats selected for cancellation.';
        req.session.save(() => {
            return res.redirect(`/booking/view/${order_id}`);
        });
        return;
    }

    try {
        const order = await prisma.order.findUnique({
            where: { id: parseInt(order_id, 10) },
        });

        if (!order) {
            req.session.error = 'Order not found.';
            req.session.save(() => {
                return res.redirect('/bookings');
            });
            return;
        }

        // --- Start Robust Parsing for order.seat_ids ---
        let orderSeatDetails: Array<{ seatId: string; type_id?: string; ticketTypeName?: string; price?: number; color?: string }> = [];
        if (typeof order.seat_ids === 'string') {
            try {
                const parsed = JSON.parse(order.seat_ids);
                if (Array.isArray(parsed)) {
                    orderSeatDetails = parsed.map((seat: any) => {
                        if (typeof seat === 'object' && seat !== null && 'seatId' in seat) {
                            return seat;
                        } else if (typeof seat === 'string') {
                            return { seatId: seat };
                        }
                        return {};
                    }).filter(seat => 'seatId' in seat);
                }
            } catch (e) {
                console.warn("Failed to parse order.seat_ids as JSON string. Attempting direct assignment if it's a string array:", e);
            }
        } else if (Array.isArray(order.seat_ids)) {
            orderSeatDetails = order.seat_ids.map((seat: any) => {
                if (typeof seat === 'object' && seat !== null && 'seatId' in seat) {
                    return seat;
                } else if (typeof seat === 'string') {
                    return { seatId: seat };
                }
                return {};
            }).filter(seat => 'seatId' in seat);
        }
        if (!Array.isArray(orderSeatDetails)) {
            orderSeatDetails = [];
        }
        // --- End Robust Parsing for order.seat_ids ---

        const event = await prisma.event.findUnique({
            where: { id: parseInt(order.event_id, 10) },
        });

        if (!event) {
            req.session.error = 'Associated event not found.';
            req.session.save(() => {
                return res.redirect(`/booking/view/${order_id}`);
            });
            return;
        }

        // --- Start Robust Parsing for event.seats ---
        let eventSeatDetails: Array<{ seatId: string; status: string; [key: string]: any }> = [];
        if (typeof event.seats === 'string') {
            try {
                const parsed = JSON.parse(event.seats);
                if (Array.isArray(parsed)) {
                    eventSeatDetails = parsed.map((seat: any) => {
                        if (typeof seat === 'object' && seat !== null && 'seatId' in seat && 'status' in seat) {
                            return seat;
                        } else if (typeof seat === 'string') {
                            return { seatId: seat, status: 'unknown' };
                        }
                        return {};
                    }).filter(seat => 'seatId' in seat);
                }
            } catch (e) {
                console.warn("Failed to parse event.seats as JSON string. Attempting direct assignment if it's a string array:", e);
            }
        } else if (Array.isArray(event.seats)) {
            eventSeatDetails = event.seats.map((seat: any) => {
                if (typeof seat === 'object' && seat !== null && 'seatId' in seat && 'status' in seat) {
                    return seat;
                } else if (typeof seat === 'string') {
                    return { seatId: seat, status: 'unknown' };
                }
                return {};
            }).filter(seat => 'seatId' in seat);
        }
        if (!Array.isArray(eventSeatDetails)) {
            eventSeatDetails = [];
        }
        // --- End Robust Parsing for event.seats ---

        const cancelledSeatIdsForMessage: string[] = [];
        const successfullyCancelledRecords: any[] = [];
        let totalAmountReduced = 0;

        const seatIdsToCancelSet = new Set(canceledSeats.map(seat => seat.seatId));

        const newOrderSeatDetails = orderSeatDetails.filter(seat => {
            return !seatIdsToCancelSet.has(seat.seatId);
        });

        for (const seatToCancel of canceledSeats) {
            const { seatId, type_id, ticketTypeName, price } = seatToCancel;

            const seatPrice = parseFloat(price.toString());
            if (isNaN(seatPrice)) {
                console.warn(`Invalid price for seat ${seatId}. Skipping price reduction for this seat.`);
                continue;
            }

            let seatFoundInEvent = false;
            eventSeatDetails = eventSeatDetails.map(seat => {
                if (seat.seatId === seatId) {
                    seat.status = "available";
                    seatFoundInEvent = true;
                }
                return seat;
            });

            if (!seatFoundInEvent) {
                console.warn(`Seat ${seatId} was selected for cancellation but not found in event ${event.id} seat_details. Skipping event seat update for this seat.`);
            }

            successfullyCancelledRecords.push({
                order_id: parseInt(order_id, 10),
                type: 'seat',
                seat_id: seatId,
                type_id: String(type_id),
                ticketTypeName: ticketTypeName,
                price: seatPrice,
            });
            cancelledSeatIdsForMessage.push(seatId);
            totalAmountReduced += seatPrice;
        }

        if (successfullyCancelledRecords.length === 0) {
            req.session.error = 'No valid seats were found in this booking to cancel or an error occurred during processing.';
            req.session.save(() => {
                return res.redirect(`/booking/view/${order_id}`);
            });
            return;
        }

        const currentSubTotal = parseFloat(order.sub_total.toString());
        const currentTotal = parseFloat(order.total.toString());
        const newSubTotal = currentSubTotal - totalAmountReduced;
        const newTotal = currentTotal - totalAmountReduced;

        await prisma.order.update({
            where: { id: parseInt(order_id, 10) },
            data: {
                seat_ids: JSON.stringify(newOrderSeatDetails.map(seat => seat.seatId)), // Store only seatId strings
                sub_total: newSubTotal,
                total: newTotal,
            },
        });

        await prisma.event.update({
            where: { id: parseInt(order.event_id, 10) },
            data: {
                seats: JSON.stringify(eventSeatDetails),
            },
        });

        if (successfullyCancelledRecords.length > 0) {
            await prisma.canceledTicket.createMany({
                data: successfullyCancelledRecords,
                skipDuplicates: true,
            });
        }

        // Prepare data for the cancellation email
        const cancellationDetails = successfullyCancelledRecords.map(record => ({
            seatId: record.seat_id,
            ticketTypeName: record.ticketTypeName,
            price: record.price,
        }));

        const templatePath = path.join(__dirname, '../../views/email-templates/ticket-cancel-template.ejs');
        const emailHtml = await ejs.renderFile(templatePath, {
            first_name: order.first_name,
            event_name: event.name,
            order_id: order.id,
            cancellationDetails: cancellationDetails,
            totalAmountReduced: totalAmountReduced.toFixed(2),
        });

        // --- Send email ---
        await transporter.sendMail({
            from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
            to: order.email,
            subject: `Your Event Ticket Cancellation for ${event.name}`,
            html: emailHtml,
        });

        req.session.success = `Successfully cancelled seat(s): ${cancelledSeatIdsForMessage.join(', ')}. Total amount reduced by Rs. ${totalAmountReduced.toFixed(2)}.`;
        req.session.save(() => {
            res.redirect(`/booking/view/${order_id}`);
        });

    } catch (err) {
        console.error("Error cancelling seat(s):", err);
        req.session.error = 'An error occurred while cancelling the seat(s). Please try again.';
        req.session.save(() => {
            res.redirect(`/booking/view/${order_id}`);
        });
    }
};

export const cancelTicketsWithoutSeat = async (req: Request, res: Response) => {
    const order_id = req.params.id;
    const { cancelQuantity, ticketTypeId, ticketTypeName } = req.body;

    // Validate incoming data
    if (!cancelQuantity || !ticketTypeId || !ticketTypeName) {
        req.session.error = 'Missing cancellation quantity, ticket type ID, or ticket type name.';
        req.session.save(() => {
            return res.redirect(`/booking/view/${order_id}`);
        });
        return;
    }

    const quantityToCancel = parseInt(cancelQuantity, 10);

    if (isNaN(quantityToCancel) || quantityToCancel <= 0) {
        req.session.error = 'Invalid cancellation quantity.';
        req.session.save(() => {
            return res.redirect(`/booking/view/${order_id}`);
        });
        return;
    }

    try {
        // Fetch the order from the database
        const order = await prisma.order.findUnique({
            where: { id: parseInt(order_id, 10) },
        });

        if (!order) {
            req.session.error = 'Order not found.';
            req.session.save(() => {
                return res.redirect('/bookings');
            });
            return;
        }

        // --- Robustly parse order.tickets_without_seats ---
        let ticketsWithoutSeats: { issued_count: number; ticket_count: number; ticket_type_id: number }[] = [];
        if (typeof order.tickets_without_seats === 'string') {
            try {
                ticketsWithoutSeats = JSON.parse(order.tickets_without_seats);
            } catch (e) {
                console.error("Failed to parse tickets_without_seats from order:", e);
                req.session.error = 'An error occurred while processing order ticket data.';
                req.session.save(() => {
                    return res.redirect(`/booking/view/${order_id}`);
                });
                return;
            }
        } else if (Array.isArray(order.tickets_without_seats)) {
            ticketsWithoutSeats = order.tickets_without_seats as { issued_count: number; ticket_count: number; ticket_type_id: number }[];
        }

        // Find and update the specific ticket type in the order's tickets_without_seats
        let ticketFoundInOrder = false;
        let originalTicketCount = 0;
        const updatedTicketsWithoutSeats = ticketsWithoutSeats.map(ticket => {
            if (ticket.ticket_type_id === parseInt(ticketTypeId, 10)) {
                originalTicketCount = ticket.ticket_count;
                if (ticket.ticket_count < quantityToCancel) {
                    req.session.error = `Cannot cancel ${quantityToCancel} tickets. Only ${ticket.ticket_count} available for cancellation for ${ticketTypeName}.`;
                    req.session.save(() => {
                        // Throwing an error here will catch in the outer try/catch
                        throw new Error("Insufficient tickets to cancel in order.");
                    });
                }
                ticketFoundInOrder = true;
                return {
                    ...ticket,
                    ticket_count: ticket.ticket_count - quantityToCancel,
                };
            }
            return ticket;
        });

        if (!ticketFoundInOrder) {
            req.session.error = `Ticket type ${ticketTypeName} not found in this order's tickets without seats.`;
            req.session.save(() => {
                return res.redirect(`/booking/view/${order_id}`);
            });
            return;
        }

        // Fetch the event associated with the order to update its ticket details
        const event = await prisma.event.findUnique({
            where: { id: parseInt(order.event_id, 10) },
        });

        if (!event) {
            req.session.error = 'Associated event not found.';
            req.session.save(() => {
                return res.redirect(`/booking/view/${order_id}`);
            });
            return;
        }

        // --- Robustly parse event.ticket_details ---
        let eventTicketDetails: { price: number; ticketCount: number; ticketTypeId: number; hasTicketCount: boolean; bookedTicketCount: number }[] = [];
        if (typeof event.ticket_details === 'string') {
            try {
                eventTicketDetails = JSON.parse(event.ticket_details);
            } catch (e) {
                console.error("Failed to parse event ticket_details:", e);
                req.session.error = 'An error occurred while processing event ticket data.';
                req.session.save(() => {
                    return res.redirect(`/booking/view/${order_id}`);
                });
                return;
            }
        } else if (Array.isArray(event.ticket_details)) {
            eventTicketDetails = event.ticket_details as { price: number; ticketCount: number; ticketTypeId: number; hasTicketCount: boolean; bookedTicketCount: number }[];
        }

        // Find the ticket type in event's ticket_details and get its price
        let ticketPrice = 0;
        let ticketFoundInEvent = false;
        const updatedEventTicketDetails = eventTicketDetails.map(detail => {
            if (detail.ticketTypeId === parseInt(ticketTypeId, 10)) {
                ticketPrice = detail.price; // Get the price for calculation
                if (detail.bookedTicketCount < quantityToCancel) {
                   console.warn(`Attempted to cancel ${quantityToCancel} tickets but only ${detail.bookedTicketCount} were marked as booked for ticket type ${ticketTypeName} in event.`);
                }
                ticketFoundInEvent = true;
                return {
                    ...detail,
                    bookedTicketCount: Math.max(0, detail.bookedTicketCount - quantityToCancel),
                };
            }
            return detail;
        });

        if (!ticketFoundInEvent) {
             console.warn(`Ticket type ${ticketTypeName} (ID: ${ticketTypeId}) not found in event ${event.id} ticket_details.`);
             req.session.error = `Ticket type ${ticketTypeName} not found in event details. Cannot proceed with cancellation.`;
             req.session.save(() => {
                 return res.redirect(`/booking/view/${order_id}`);
             });
             return;
        }

        // Calculate the total amount to be reduced from the order
        const totalAmountReduced = quantityToCancel * ticketPrice;
        const currentSubTotal = parseFloat(order.sub_total.toString());
        const currentTotal = parseFloat(order.total.toString());
        const newSubTotal = currentSubTotal - totalAmountReduced;
        const newTotal = currentTotal - totalAmountReduced;

        // Perform database updates for order, event, and canceled tickets record
        await prisma.order.update({
            where: { id: parseInt(order_id, 10) },
            data: {
                tickets_without_seats: JSON.stringify(updatedTicketsWithoutSeats),
                sub_total: newSubTotal, // Update sub_total
                total: newTotal,       // Update total
            },
        });

        await prisma.event.update({
            where: { id: parseInt(order.event_id, 10) },
            data: {
                ticket_details: JSON.stringify(updatedEventTicketDetails),
            },
        });

        // Record the cancellation in canceledTicket model
        await prisma.canceledTicket.create({
            data: {
                order_id: parseInt(order_id, 10),
                type: 'no seat', // Indicates this is a ticket without a specific seat
                type_id: ticketTypeId,
                ticketTypeName: ticketTypeName,
                quantity: quantityToCancel,
                price: Number(totalAmountReduced), // Store the total price for these tickets
            },
        });

        // Prepare data for the cancellation email (using the same template)
        const nonSeatTicketsCancellationDetails = [{
            ticketTypeName: ticketTypeName,
            quantity: quantityToCancel,
            pricePerTicket: ticketPrice.toFixed(2), // Price per individual ticket
            totalPrice: totalAmountReduced.toFixed(2), // Total price for this cancellation batch
        }];

        const templatePath = path.join(__dirname, '../../views/email-templates/ticket-cancel-template.ejs');
        const emailHtml = await ejs.renderFile(templatePath, {
            first_name: order.first_name,
            event_name: event.name,
            order_id: order.id,
            cancellationDetails: [],
            nonSeatTicketsCancellationDetails: nonSeatTicketsCancellationDetails,
            totalAmountReduced: totalAmountReduced.toFixed(2), // Total amount for the email summary
        });

        // --- Send email notification ---
        await transporter.sendMail({
            from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
            to: order.email,
            subject: `Your Event Ticket Cancellation for ${event.name}`,
            html: emailHtml,
        });

        // Set success message and redirect
        req.session.success = `${quantityToCancel} x ${ticketTypeName} tickets cancelled successfully. Total amount reduced by Rs. ${totalAmountReduced.toFixed(2)}.`;
        req.session.save(() => {
            res.redirect(`/booking/view/${order_id}`);
        });

    } catch (err: any) {
        console.error("Error cancelling tickets without seat:", err);
        // Only set error message if not already set by an earlier thrown error
        if (!req.session.error) {
            req.session.error = 'An error occurred while cancelling the tickets without seats. Please try again.';
        }
        req.session.save(() => {
            res.redirect(`/booking/view/${order_id}`);
        });
    }
};
export const cancelEntireBooking = async (req: Request, res: Response) => {
    const order_id = req.params.id;

    try {
        const order = await prisma.order.findUnique({
            where: { id: parseInt(order_id, 10) },
        });

        if (!order) {
            req.session.error = 'Order not found.';
            req.session.save(() => {
                return res.redirect('/bookings');
            });
            return;
        }

        const event = await prisma.event.findUnique({
            where: { id: parseInt(order.event_id, 10) },
        });

        if (!event) {
            req.session.error = 'Associated event not found for this order.';
            req.session.save(() => {
                return res.redirect(`/booking/view/${order_id}`);
            });
            return;
        }

        // --- Fetch all ticket types for lookup ---
        const ticketTypes = await prisma.ticketType.findMany({});
        const ticketTypeNameMap = new Map<number, string>();
        ticketTypes.forEach(type => {
            ticketTypeNameMap.set(type.id, type.name || 'Unnamed Ticket Type');
        });

        let totalAmountReduced = 0;
        const cancellationDetails: any[] = []; // For seated tickets
        const nonSeatTicketsCancellationDetails: any[] = []; // For non-seated tickets

        // --- Handle Assigned Seats Cancellation ---
        let orderSeatDetails: Array<{ seatId: string; type_id?: string; ticketTypeName?: string; price?: number; color?: string }> = [];
        if (typeof order.seat_ids === 'string') {
            try {
                const parsed = JSON.parse(order.seat_ids);
                if (Array.isArray(parsed)) {
                    orderSeatDetails = parsed.map((seat: any) => {
                        if (typeof seat === 'object' && seat !== null && 'seatId' in seat) {
                            return seat;
                        } else if (typeof seat === 'string') {
                            // If only seatId string is stored, we need to infer type_id and price
                            // This might require fetching ticket type details from the event or globally
                            // For simplicity, we'll try to find it in eventSeatDetails later
                            return { seatId: seat };
                        }
                        return {};
                    }).filter(seat => 'seatId' in seat);
                }
            } catch (e) {
                console.error("Failed to parse seat_ids from order during full cancellation (JSON string):", e);
            }
        } else if (Array.isArray(order.seat_ids)) {
            orderSeatDetails = order.seat_ids.map((seat: any) => {
                if (typeof seat === 'object' && seat !== null && 'seatId' in seat) {
                    return seat;
                } else if (typeof seat === 'string') {
                    return { seatId: seat };
                }
                return {};
            }).filter(seat => 'seatId' in seat);
        }

        let eventSeatDetails: Array<{ seatId: string; status: string; price: number; type_id: number; color: string }> = [];
        if (typeof event.seats === 'string') {
            try {
                eventSeatDetails = JSON.parse(event.seats);
            } catch (e) {
                console.error("Failed to parse event seat_details during full cancellation (JSON string):", e);
            }
        } else if (Array.isArray(event.seats)) {
            eventSeatDetails = event.seats as { seatId: string; status: string; price: number; type_id: number; color: string }[];
        }

        // Iterate through all seats currently in the order
        for (const seatInOrder of orderSeatDetails) {
            const seatIdToCancel = seatInOrder.seatId;
            let ticketTypeNameForCanceledSeat: string = 'N/A';
            let typeIdForCanceledSeat: number = 0;
            let priceForCanceledSeat: number = 0;

            const seatInEvent = eventSeatDetails.find(eventSeat => eventSeat.seatId === seatIdToCancel);

            if (seatInEvent) {
                // Update event seat status to available
                seatInEvent.status = "available";
                typeIdForCanceledSeat = seatInEvent.type_id;
                priceForCanceledSeat = seatInEvent.price;
                ticketTypeNameForCanceledSeat = ticketTypeNameMap.get(typeIdForCanceledSeat) || `Type ${typeIdForCanceledSeat}`;

                totalAmountReduced += priceForCanceledSeat;

                // Add to cancellation details for email
                cancellationDetails.push({
                    seatId: seatIdToCancel,
                    ticketTypeName: ticketTypeNameForCanceledSeat,
                    price: priceForCanceledSeat,
                });

                // Record in canceledTicket model
                await prisma.canceledTicket.create({
                    data: {
                        order_id: parseInt(order_id, 10),
                        type: 'seat',
                        seat_id: seatIdToCancel,
                        type_id: String(typeIdForCanceledSeat),
                        ticketTypeName: ticketTypeNameForCanceledSeat,
                        quantity: 1,
                        price: priceForCanceledSeat,
                    },
                });
            } else {
                console.warn(`Seat ${seatIdToCancel} not found in event ${event.id} seat_details during full cancellation.`);
                // If seat not found in event details, try to use details from orderSeatDetails if available
                if (seatInOrder.price) {
                    totalAmountReduced += parseFloat(seatInOrder.price.toString());
                    cancellationDetails.push({
                        seatId: seatIdToCancel,
                        ticketTypeName: seatInOrder.ticketTypeName || 'N/A',
                        price: seatInOrder.price,
                    });
                     await prisma.canceledTicket.create({
                        data: {
                            order_id: parseInt(order_id, 10),
                            type: 'seat',
                            seat_id: seatIdToCancel,
                            type_id: seatInOrder.type_id || '0', // Fallback
                            ticketTypeName: seatInOrder.ticketTypeName || 'N/A',
                            quantity: 1,
                            price: parseFloat(seatInOrder.price.toString()),
                        },
                    });
                }
            }
        }

        await prisma.event.update({
            where: { id: parseInt(order.event_id, 10) },
            data: {
                seats: JSON.stringify(eventSeatDetails),
            },
        });

        // --- Handle Tickets Without Assigned Seats Cancellation ---
        let ticketsWithoutSeatsInOrder: { issued_count: number; ticket_count: number; ticket_type_id: number; name?: string }[] = [];
        if (typeof order.tickets_without_seats === 'string') {
            try {
                ticketsWithoutSeatsInOrder = JSON.parse(order.tickets_without_seats);
            } catch (e) {
                console.error("Failed to parse tickets_without_seats from order during full cancellation (JSON string):", e);
            }
        } else if (Array.isArray(order.tickets_without_seats)) {
            ticketsWithoutSeatsInOrder = order.tickets_without_seats as { issued_count: number; ticket_count: number; ticket_type_id: number; name?: string }[];
        }

        let eventTicketDetails: { price: number; ticketCount: number; ticketTypeId: number; hasTicketCount: boolean; bookedTicketCount: number; name?: string }[] = [];
        if (typeof event.ticket_details === 'string') {
            try {
                eventTicketDetails = JSON.parse(event.ticket_details);
            } catch (e) {
                console.error("Failed to parse event ticket_details during full cancellation (JSON string):", e);
            }
        } else if (Array.isArray(event.ticket_details)) {
            eventTicketDetails = event.ticket_details as { price: number; ticketCount: number; ticketTypeId: number; hasTicketCount: boolean; bookedTicketCount: number; name?: string }[];
        }

        for (const ticket of ticketsWithoutSeatsInOrder) {
            const quantityToCancel = ticket.ticket_count;
            const ticketTypeId = ticket.ticket_type_id;
            const ticketTypeName = ticketTypeNameMap.get(ticketTypeId) || 'N/A';

            if (quantityToCancel > 0) {
                let ticketPrice = 0;
                const ticketTypeFoundAndUpdated = eventTicketDetails.some(detail => {
                    if (detail.ticketTypeId === ticketTypeId) {
                        ticketPrice = detail.price;
                        detail.bookedTicketCount = Math.max(0, detail.bookedTicketCount - quantityToCancel);
                        return true;
                    }
                    return false;
                });

                if (!ticketTypeFoundAndUpdated) {
                    console.warn(`Ticket type ${ticketTypeName} (ID: ${ticketTypeId}) not found in event ${event.id} ticket_details during full cancellation.`);
                }

                const totalTicketsPrice = quantityToCancel * ticketPrice;
                totalAmountReduced += totalTicketsPrice;

                // Add to non-seat tickets cancellation details for email
                nonSeatTicketsCancellationDetails.push({
                    ticketTypeName: ticketTypeName,
                    quantity: quantityToCancel,
                    pricePerTicket: ticketPrice.toFixed(2),
                    totalPrice: totalTicketsPrice.toFixed(2),
                });

                await prisma.canceledTicket.create({
                    data: {
                        order_id: parseInt(order_id, 10),
                        type: 'no seat',
                        type_id: String(ticketTypeId),
                        ticketTypeName: ticketTypeName,
                        quantity: quantityToCancel,
                        price: Number(totalTicketsPrice),
                    },
                });
            }
        }

        await prisma.event.update({
            where: { id: parseInt(order.event_id, 10) },
            data: {
                ticket_details: JSON.stringify(eventTicketDetails),
            },
        });

        // --- Finalize Order Cancellation ---
        const currentSubTotal = parseFloat(order.sub_total.toString());
        const currentTotal = parseFloat(order.total.toString());
        const newSubTotal = currentSubTotal - totalAmountReduced;
        const newTotal = currentTotal - totalAmountReduced;

        await prisma.order.update({
            where: { id: parseInt(order_id, 10) },
            data: {
                seat_ids: JSON.stringify([]), // Clear all assigned seats
                tickets_without_seats: JSON.stringify([]), // Clear all unassigned tickets
                status: 'cancelled', // Update order status to 'cancelled'
                sub_total: newSubTotal, // Update sub_total
                total: newTotal,       // Update total
            },
        });

        // --- Send email ---
        const templatePath = path.join(__dirname, '../../views/email-templates/ticket-cancel-template.ejs');
        const emailHtml = await ejs.renderFile(templatePath, {
            first_name: order.first_name,
            event_name: event.name,
            order_id: order.id,
            cancellationDetails: cancellationDetails,
            nonSeatTicketsCancellationDetails: nonSeatTicketsCancellationDetails,
            totalAmountReduced: totalAmountReduced.toFixed(2),
        });

        await transporter.sendMail({
            from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
            to: order.email,
            subject: `Your Event Ticket Cancellation for ${event.name}`,
            html: emailHtml,
        });

        req.session.success = `Booking ${order_id} and all associated tickets have been cancelled successfully. Total amount reduced by Rs. ${totalAmountReduced.toFixed(2)}.`;
        req.session.save(() => {
            res.redirect(`/booking/view/${order_id}`);
        });

    } catch (err: any) {
        console.error("Error cancelling entire booking:", err);
        req.session.error = 'An error occurred while cancelling the entire booking. Please try again.';
        req.session.save(() => {
            res.redirect(`/booking/view/${order_id}`);
        });
    }
};

export const cancelledTickets = async (req: Request, res: Response) => {
  const tickets = await prisma.canceledTicket.findMany({});

  const ticketsWithDetails = await Promise.all(
    tickets.map(async (ticket: any) => {
      const order = await prisma.order.findUnique({
        where: {
          id: ticket.order_id,
        },
      });

      let event = null;
      if (order && order.event_id) {
        event = await prisma.event.findUnique({
          where: {
            id: Number(order.event_id),
          },
        });
      }

      return {
        ...ticket,
        eventName: event ? event.name : 'N/A',
        location: event ? event.location : 'N/A',
      };
    })
  );

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('booking/cancelled-tickets', {
    error,
    success,
    tickets: ticketsWithDetails, 
  });
};