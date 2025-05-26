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
    const eventSeats: any[] = (event.seats as any) || [];

    const seats = seatIdsForType.map((seatId: string) => {
      const seat = eventSeats.find(
        (s) => s.seatId === seatId && s.type_id === ticketTypeId
      );
 
      return {
        seatId,
        status: seat?.status || 'unknown',
      };
    });

    const ticketTypeName =
      eventSeats.find((s) => s.type_id === ticketTypeId)?.ticketTypeName || 'Unknown';

    return res.json({
      eventName: event.name,
      ticketTypeName,
      seats,
    });
  } catch (err) {
    console.error('Ticket verification error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};   