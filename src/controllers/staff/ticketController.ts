import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

interface EventSeat {
    price: number;
    seatId: string;
    status: string;
    type_id: number;
    ticketTypeName: string;
}

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
    const { orderId, ticketTypeId, seatIdsForType } = req.body;

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

    const eventName = event.name || 'Unknown Event';

    const allEventSeats: EventSeat[] = (event.seats as EventSeat[] | null) || [];

    const relevantSeats = seatIdsForType.map((requestedSeatId: string) => {
        const foundSeat = allEventSeats.find(
            (seat) =>
                seat.seatId === requestedSeatId && seat.type_id === ticketTypeId
        );
        return {
            seatId: requestedSeatId,
            status: foundSeat ? foundSeat.status : 'notFound',
        };
    });

    const ticketTypeInfo = allEventSeats.find(
        (seat) => seat.type_id === ticketTypeId
    );
    const ticketTypeName = ticketTypeInfo ? ticketTypeInfo.ticketTypeName : 'Unknown Ticket Type';


    return res.status(200).json({
        eventName,
        ticketTypeName,
        seats: relevantSeats,
    });
};
