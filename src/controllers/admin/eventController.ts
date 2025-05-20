import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import slugify from 'slugify';
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

    let baseSlug = slugify(name, { lower: true, strict: true });
    let uniqueSlug = baseSlug;
    let suffix = 1;

    while (await prisma.event.findUnique({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${baseSlug}-${suffix++}`;
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
        slug: uniqueSlug,
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
  const events = await prisma.event.findMany({ });

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('event/events', {
    error,
    success,
    events,
  });
};


export const activateEvent = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.event.update({
      where: { id },
      data: { status: 'active' },
    });
    req.session.success = 'Event activated successfully!';
  } catch (error) {
    console.error('Error activating event:', error);
    req.session.error = 'Failed to activate event. Please try again.';
  }
  return res.redirect('/events'); 
};

export const deactivateEvent = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.event.update({
      where: { id },
      data: { status: 'inactive' },
    });
    req.session.success = 'Event deactivated successfully!';
  } catch (error) {
    console.error('Error deactivating event:', error);
    req.session.error = 'Failed to deactivate event. Please try again.';
  }
  return res.redirect('/events');
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

  try {
    const event = await prisma.event.findFirst({
      where: { id },
    });

    if (!event) {
      req.session.error = 'Event not found.';
      return res.redirect('/events'); 
    }

    const allArtists = await prisma.artist.findMany({ where: { status: 'active' } });

    const ticket_types = await prisma.ticketType.findMany({ where: { status: 'active' } });

    const selectedArtistIds: number[] = Array.isArray(event.artist_details)
      ? event.artist_details.map(Number)
      : [];

    const enrichedTickets = Array.isArray(event.ticket_details)
      ? event.ticket_details.map((ticket: any) => {
          const ticketType = ticket_types.find(tt => tt.id === ticket.ticketTypeId);
          return {
            type_id: ticket.ticketTypeId, 
            price: ticket.price,
            count: ticket.ticketCount, 
            has_ticket_count: ticketType?.has_ticket_count || false,
            ticketTypeName: ticketType?.name || 'Unknown', 
          };
        })
      : [];

    const enrichedEvent = {
      ...event,
      artist_details: selectedArtistIds, 
      ticket_details: enrichedTickets,
    };

    res.render('event/edit-event', {
      error,
      success,
      formData,
      validationErrors,
      enrichedEvent,
      allArtists, 
      ticket_types, 
    });
  } catch (err) {
    console.error('Error fetching event for edit:', err);
    req.session.error = 'An unexpected error occurred while loading the event for editing.';
    return res.redirect('/events'); 
  }
};
export const editEventPost = async (req: Request, res: Response) => {
  const eventId = Number(req.params.id);

  // const schema = z.object({
  //   name: z.string().min(1, 'Name is required'),
  //   discription: z.string().min(1, 'Description is required'),
  //   policy: z.string().min(1, 'Ticket Policy is required'),
  //   organized_by: z.string().min(1, 'Organized by is required'),
  //   location: z.string().min(1, 'Location is required'),
  //   artists: z
  //     .union([z.string(), z.array(z.string())])
  //     .optional()
  //     .transform((val) => (Array.isArray(val) ? val : val ? [val] : [])),
  //   tickets: z.array(z.object({
  //     type_id: z.string().min(1, 'Ticket type is required'),
  //     price: z.string().min(1, 'Ticket price is required'),
  //     count: z.string().optional(),
  //   })).optional().default([]),
  // });

  // const result = schema.safeParse(req.body);

  // if (!result.success) {
  //   const errors = result.error.flatten().fieldErrors;
  //   req.session.error = 'Please fix the errors below.';
  //   req.session.formData = req.body;
  //   req.session.validationErrors = errors;
  //   console.log(errors);
  //   return res.redirect(`/event/edit/${eventId}`);
  // }

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
  } = req.body;

  const bannerImageFile = (req.files as { [fieldname: string]: Express.Multer.File[] })?.banner_image?.[0];
  const featuredImageFile = (req.files as { [fieldname: string]: Express.Multer.File[] })?.featured_image?.[0];

  try {
    const existingEvent = await prisma.event.findUnique({
      where: { id: eventId },
      select: { banner_image: true, featured_image: true, slug: true, name: true }, 
    });

    if (!existingEvent) {
      req.session.error = 'Event not found.';
      return res.redirect('/events');
    }

    let bannerImageUrl: string | null = existingEvent.banner_image; 
    let featuredImageUrl: string | null = existingEvent.featured_image; 


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

    let uniqueSlug = existingEvent.slug;
    if (name !== existingEvent.name) {
      let baseSlug = slugify(name, { lower: true, strict: true });
      let suffix = 1;
      while (await prisma.event.findFirst({ where: { slug: uniqueSlug, NOT: { id: eventId } } })) {
        uniqueSlug = `${baseSlug}-${suffix++}`;
      }
    }

    const ticketDetailsJson = tickets.map((ticket: any) => ({
      ticketTypeId: parseInt(ticket.type_id, 10),
      price: parseFloat(ticket.price),
      ticketCount: ticket.count ? parseInt(ticket.count, 10) : null,
    }));

    const artistIdsJson = artists.map(Number);

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        name,
        slug: uniqueSlug,
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

      },
    });

    req.session.success = 'Event updated successfully!';
    req.session.formData = {};
    req.session.validationErrors = {};
    return res.redirect(`/event/edit/${updatedEvent.id}`); 
  } catch (err) {
    console.error('Error updating event:', err);
    req.session.error = 'An unexpected error occurred while updating the event.';
    req.session.formData = req.body;
    return res.redirect(`/event/edit/${eventId}`);
  }
};