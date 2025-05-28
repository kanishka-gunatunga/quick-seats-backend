import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

export const addTicketTypeGet = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('event/add-ticket-type', {
    error,
    success,
    formData,
    validationErrors,
  });
};

export const addTicketTypePost = async (req: Request, res: Response) => {
  const schema = z
    .object({
      name: z.string().min(1, 'Name is required'),
      color: z.string().min(1, 'Color is required'),
      has_ticket_count: z.string().optional(),
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.formData = req.body;
    req.session.validationErrors = errors;
    return res.redirect('/add-admin'); 
  }

  const { name,has_ticket_count,color} = result.data;

  try {


    await prisma.ticketType.create({
      data: {
        name,
        color
        has_ticket_count,
        status: 'active',
      },
    });


    req.session.success = 'Ticket type added successfully!';
    req.session.formData = {}; 
    req.session.validationErrors = {};
    return res.redirect('/add-ticket-type'); 
  } catch (err) {
    console.error('Error adding ticket type:', err);
    req.session.error = 'An unexpected error occurred while adding the ticket type.';
    req.session.formData = req.body;
    return res.redirect('/add-ticket-type'); 
  }
};

export const ticketTypes = async (req: Request, res: Response) => {
  const ticketTypes = await prisma.ticketType.findMany({ });

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('event/ticket-types', {
    error,
    success,
    ticketTypes,
  });
};


export const activateTicketType = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.ticketType.update({
      where: { id },
      data: { status: 'active' },
    });
    req.session.success = 'Ticket type activated successfully!';
  } catch (error) {
    console.error('Error activating ticket type:', error);
    req.session.error = 'Failed to activate Ticket type. Please try again.';
  }
  return res.redirect('/ticket-types'); 
};

export const deactivateTicketType = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.ticketType.update({
      where: { id },
      data: { status: 'inactive' },
    });
    req.session.success = 'Ticket type deactivated successfully!';
  } catch (error) {
    console.error('Error deactivating ticket type:', error);
    req.session.error = 'Failed to deactivate ticket type. Please try again.';
  }
  return res.redirect('/ticket-types');
};


export const editTicketTypeGet = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  const ticketType = await prisma.ticketType.findUnique({
    where: { id }
  });

  res.render('event/edit-ticket-type', {
    error,
    success,
    formData,
    validationErrors,
    ticketType,
  });
};
export const editTicketTypePost = async (req: Request, res: Response) => {
  const schema = z
    .object({
      name: z.string().min(1, 'Name is required'),
      color: z.string().min(1, 'Color is required'),
      has_ticket_count: z.string().optional(),
    });


  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.validationErrors = errors;
    return res.redirect(`/ticket-type/edit/${req.params.id}`);
  }

  const { name,has_ticket_count,color } = result.data;
  const userId = parseInt(req.params.id);

  try {
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: userId }
    });

    if (!ticketType) {
      req.session.error = 'Ticket type not found.';
      return res.redirect('/ticket-types');
    }

    await prisma.ticketType.update({
      where: { id: userId },
      data: {
        name,
        color
        has_ticket_count
      },
    });


    req.session.success = 'Ticket type updated successfully!';
    req.session.validationErrors = {};
    return res.redirect(`/ticket-type/edit/${userId}`);
  } catch (err) {
    console.error('Error updating artist:', err);
    req.session.error = 'An unexpected error occurred while updating the ticket type.';
    return res.redirect(`/ticket-type/edit/${userId}`);
  }
};
