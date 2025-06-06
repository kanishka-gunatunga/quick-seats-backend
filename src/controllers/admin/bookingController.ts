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