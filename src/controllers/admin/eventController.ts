import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { put } from '@vercel/blob';
import upload from '../../middlewares/upload';

const prisma = new PrismaClient();

export const addEventGet = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  const artists = await prisma.artist.findMany({where: { status:'active' } });
  const ticket_types = await prisma.ticketType.findMany({where: { status:'active' } });

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('event/add-event', {
    error,
    success,
    formData,
    validationErrors,
    artists,
    ticket_types,
  });
};

export const addEventPost = async (req: Request, res: Response) => {

 const schema = z.object({
    name: z.string().min(1, 'Name is required'),
    start_date_time: z.string().min(1, 'Start date and time is required'),
    end_date_time: z.string().min(1, 'End date and time is required'),
    discription: z.string().min(1, 'Description is required'),
    policy: z.string().min(1, 'Ticket Policy is required'),
    organized_by: z.string().min(1, 'Organized by is required'),
    location: z.string().min(1, 'Location is required'),
    artists: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((val) => (Array.isArray(val) ? val : val ? [val] : [])),
    tickets: z.array(z.object({
      type_id: z.string().min(1, 'Ticket type is required'),
      price: z.string().min(1, 'Ticket price is required'),
      count: z.string().optional(),
    })).optional().default([]),
  });

  const result = schema.safeParse(req.body);

  

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.formData = req.body;
    req.session.validationErrors = errors;
    return res.redirect('/add-admin'); 
  }

   const {
    name,
    start_date_time,
    end_date_time,
    discription,
    policy,
    organized_by,
    location,
    artists,
    tickets,
  } = result.data;

  const bannerImageFile = (req.files as { [fieldname: string]: Express.Multer.File[] })?.banner_image?.[0];
  const featuredImageFile = (req.files as { [fieldname: string]: Express.Multer.File[] })?.featured_image?.[0];

  let bannerImageUrl: string | null = null;
  let featuredImageUrl: string | null = null;

  try {

if (bannerImageFile) {
      const { url } = await put(bannerImageFile.originalname, bannerImageFile.buffer, {
        access: 'public', 
        addRandomSuffix: true,
      });
      bannerImageUrl = url;
    }

    if (featuredImageFile) {
      const { url } = await put(featuredImageFile.originalname, featuredImageFile.buffer, {
        access: 'public',
        addRandomSuffix: true,
      });
      featuredImageUrl = url;
    }
    const ticketDetailsJson = tickets.map((ticket: any) => ({
      ticketTypeId: parseInt(ticket.type_id, 10),
      price: parseFloat(ticket.price),
      ticketCount: ticket.count ? parseInt(ticket.count, 10) : null,
    }));

    const artistIdsJson = artists;

    const event = await prisma.event.create({
      data: {
        name,
        start_date_time: new Date(start_date_time),
        end_date_time: new Date(end_date_time),
        description: discription,
        policy: policy,
        organized_by: organized_by,
        location,
        banner_image: bannerImageUrl,
        featured_image: featuredImageUrl,
        ticket_details: ticketDetailsJson,
        artist_details: artistIdsJson,
        status: 'active',
      },
    });


    req.session.success = 'event added successfully!';
    req.session.formData = {}; 
    req.session.validationErrors = {};
    return res.redirect('/add-event'); 
  } catch (err) {
    console.error('Error adding event:', err);
    req.session.error = 'An unexpected error occurred while adding the event.';
    req.session.formData = req.body;
    return res.redirect('/add-event'); 
  }
};

export const events = async (req: Request, res: Response) => {
  const artists = await prisma.artist.findMany({ });

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('event/artists', {
    error,
    success,
    artists,
  });
};


export const activateEvent = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.artist.update({
      where: { id },
      data: { status: 'active' },
    });
    req.session.success = 'Artist activated successfully!';
  } catch (error) {
    console.error('Error activating artist:', error);
    req.session.error = 'Failed to activate artist. Please try again.';
  }
  return res.redirect('/artists'); 
};

export const deactivateEvent = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.artist.update({
      where: { id },
      data: { status: 'inactive' },
    });
    req.session.success = 'Artist deactivated successfully!';
  } catch (error) {
    console.error('Error deactivating artist:', error);
    req.session.error = 'Failed to deactivate artist. Please try again.';
  }
  return res.redirect('/artists');
};


export const editEventGet = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  const artist = await prisma.artist.findUnique({
    where: { id }
  });

  res.render('event/edit-artist', {
    error,
    success,
    formData,
    validationErrors,
    artist,
  });
};
export const editEventPost = async (req: Request, res: Response) => {
  const schema = z
    .object({
      name: z.string().min(1, 'Name is required'),
    });


  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.validationErrors = errors;
    return res.redirect(`/artist/edit/${req.params.id}`);
  }

  const { name } = result.data;
  const userId = parseInt(req.params.id);

  try {
    const artist = await prisma.artist.findUnique({
      where: { id: userId }
    });

    if (!artist) {
      req.session.error = 'Artist not found.';
      return res.redirect('/artists');
    }

    await prisma.artist.update({
      where: { id: userId },
      data: {
        name
      },
    });


    req.session.success = 'Artist updated successfully!';
    req.session.validationErrors = {};
    return res.redirect(`/artist/edit/${userId}`);
  } catch (err) {
    console.error('Error updating artist:', err);
    req.session.error = 'An unexpected error occurred while updating the artist.';
    return res.redirect(`/artist/edit/${userId}`);
  }
};
