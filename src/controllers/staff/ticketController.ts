import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();



export const issueTickets = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;

  res.render('staff/ticket/issue', { error, success, formData });
};

export const ticketVerify = async (req: Request, res: Response) => {
    try {

        const { orderId, ticketTypeId, seatIdsForType, type, ticketCount,ticketTypeName } = req.body;

        if (!orderId || !ticketTypeId || !type) {
            return res.status(400).json({ message: 'Missing essential fields: orderId, ticketTypeId, or type.' });
        }

        const order = await prisma.order.findUnique({
            where: { id: parseInt(orderId as string) }, // Ensure orderId is parsed as string
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const event = await prisma.event.findUnique({
            where: { id: parseInt(order.event_id as string) }, // Ensure event_id is parsed as string
        });

        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }

        const eventSeats: any[] = typeof event.seats === 'string'
            ? JSON.parse(event.seats)
            : (event.seats as any[]) || [];

        const eventTicketDetails: any[] = typeof event.ticket_details === 'string'
            ? JSON.parse(event.ticket_details)
            : (event.ticket_details as any[]) || [];

        let verifiedTicketDetails: any = {};

        if (type === "seat") {
            if (!Array.isArray(seatIdsForType) || seatIdsForType.length === 0) {
                return res.status(400).json({ message: 'Missing seatIdsForType for a "seat" type ticket.' });
            }

            const seats = seatIdsForType.map((seatId: string) => {
                const seat = eventSeats.find(
                    (s) => s.seatId === seatId && s.type_id === ticketTypeId
                );
                return {
                    seatId,
                    status: seat?.status || 'unknown',
                };
            });

            const ticketTypeName = eventSeats.find((s) => s.type_id === ticketTypeId)?.ticketTypeName || 'Unknown';
            verifiedTicketDetails = { ticketTypeName, seats, type: "seat",ticketTypeId };

        } else if (type === "no seat") {
            if (typeof ticketCount === 'undefined') {
                return res.status(400).json({ message: 'Missing ticketCount for a "no seat" type ticket.' });
            }
   
            const ticketDetail = eventTicketDetails.find(
                (td: any) => td.ticketTypeId === ticketTypeId
            );

            if (!ticketDetail) {
                return res.status(404).json({ message: 'Ticket type details not found for no-seat ticket.' });
            }

            verifiedTicketDetails = {
                ticketTypeName: ticketTypeName,
                count: ticketCount, 
                type: "no seat",
                ticketTypeId
            };

        } else {
            return res.status(400).json({ message: 'Invalid ticket type provided.' });
        }

        return res.json({
            eventName: event.name,
            verifiedTicketDetails, // Send back the combined details
        });

    } catch (err) {
        console.error('Ticket verification error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const confirmTicketIssue = async (req: Request, res: Response) => {
  try {
    const { orderId, seatId } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const event = await prisma.event.findUnique({
      where: { id: parseInt(order.event_id) },
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    let eventSeats: any[] = typeof event.seats === 'string'
      ? JSON.parse(event.seats)
      : (event.seats as any[]) || [];

    let seatFound = false;

    eventSeats = eventSeats.map(seat => {
      if (seat.seatId === seatId) {
        seatFound = true;
        return {
          ...seat,
          status: 'issued'
        };
      }
      return seat;
    });

    if (!seatFound) {
      return res.status(400).json({ message: 'Seat not found in event seats' });
    }

    await prisma.event.update({
      where: { id: event.id },
      data: {
        seats: JSON.stringify(eventSeats)
      }
    });

    return res.json({ message: 'Ticket successfully issued' });

  } catch (err) {
    console.error('Ticket issue error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const issueNoSeatTickets = async (req: Request, res: Response) => {
    try {
        const { orderId, ticketTypeId, countToIssue } = req.body;

        if (!orderId || !ticketTypeId || typeof countToIssue === 'undefined' || countToIssue <= 0) {
            return res.status(400).json({ message: 'Missing essential fields: orderId, ticketTypeId, or countToIssue.' });
        }

        // 1. Fetch the order
        const order = await prisma.order.findUnique({
            where: { id: parseInt(orderId as string) },
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // 2. Parse the tickets_without_seats JSON from the order
        // Ensure tickets_without_seats is handled as JSON; it might be stored as string
        let ticketsWithoutSeats: any[] = [];
        if (typeof order.tickets_without_seats === 'string') {
            try {
                ticketsWithoutSeats = JSON.parse(order.tickets_without_seats);
            } catch (jsonErr) {
                console.error('Error parsing tickets_without_seats JSON:', jsonErr);
                return res.status(500).json({ message: 'Failed to parse order ticket details.' });
            }
        } else if (Array.isArray(order.tickets_without_seats)) {
            ticketsWithoutSeats = order.tickets_without_seats;
        }

        let ticketTypeFoundAndUpdated = false;
        const updatedTicketsWithoutSeats = ticketsWithoutSeats.map((ticketDetail: any) => {
            if (ticketDetail.ticket_type_id === ticketTypeId) {
                ticketTypeFoundAndUpdated = true;

                // Ensure 'issued_count' exists and is a number, default to 0 if not
                const currentIssuedCount = typeof ticketDetail.issued_count === 'number' ? ticketDetail.issued_count : 0;
                const totalTicketsBooked = ticketDetail.ticket_count; // Total quantity for this type in the order

                // Prevent over-issuing
                if (currentIssuedCount + countToIssue > totalTicketsBooked) {
                    throw new Error(`Cannot issue ${countToIssue} tickets. Only ${totalTicketsBooked - currentIssuedCount} remaining for this type in this order.`);
                }

                // Update the issued_count
                return {
                    ...ticketDetail,
                    issued_count: currentIssuedCount + countToIssue,
                };
            }
            return ticketDetail;
        });

        if (!ticketTypeFoundAndUpdated) {
            return res.status(400).json({ message: 'Ticket type not found in this order\'s non-seated tickets.' });
        }

        // 3. Update the order table with the modified tickets_without_seats JSON
        await prisma.order.update({
            where: { id: parseInt(orderId as string) },
            data: {
                tickets_without_seats: JSON.stringify(updatedTicketsWithoutSeats), // Store as JSON string
            },
        });

        return res.status(200).json({ message: 'Tickets successfully issued.' });

    } catch (err: any) {
        console.error('Ticket issue error:', err);
        // Provide the specific error message from the thrown Error if it's a known validation error
        if (err.message.includes('Cannot issue') || err.message.includes('not found')) {
            return res.status(400).json({ message: err.message });
        }
        return res.status(500).json({ message: 'Internal server error' });
    }
};
