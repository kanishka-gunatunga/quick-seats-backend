import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import slugify from 'slugify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { put } from '@vercel/blob';
import upload from '../../middlewares/upload';
import { del } from '@vercel/blob';

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
  const eventId  = req.params.id;

  try {
    const event = await prisma.event.findUnique({
        where: {
            id: parseInt(eventId),
        },
        select: {
            ticket_details: true,
        },
    });

    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    
    const allTicketDetails: any[] = event.ticket_details ? JSON.parse(event.ticket_details as string) : [];

    const uniqueTicketTypeIds = [
            ...new Set(allTicketDetails.map((ticket: any) => ticket.ticketTypeId))
        ].filter(id => id !== undefined && id !== null); 

        const ticketTypes = await prisma.ticketType.findMany({
            where: {
                id: { in: uniqueTicketTypeIds },
            },
            select: {
                id: true,
                name: true,
            },
        });

        const ticketTypeNameMap = new Map(ticketTypes.map(tt => [tt.id, tt.name]));

        const ticketsWithoutSeats = allTicketDetails
            .filter((ticket: any) => ticket.hasTicketCount === true)
            .map((ticket: any) => ({
                ticket_type_id: ticket.ticketTypeId,
                ticket_type_name: ticketTypeNameMap.get(ticket.ticketTypeId) || 'Unknown',
                available_count: (ticket.ticketCount || 0) - (ticket.bookedTicketCount || 0),
                price: ticket.price,
            }));

        res.json(ticketsWithoutSeats);

    res.json(ticketsWithoutSeats);
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};