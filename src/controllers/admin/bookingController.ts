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
  const orders = await prisma.order.findMany({ });

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
