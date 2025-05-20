import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

export const addArtistGet = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('event/add-artist', {
    error,
    success,
    formData,
    validationErrors,
  });
};

export const addArtistPost = async (req: Request, res: Response) => {
  const schema = z
    .object({
      name: z.string().min(1, 'Name is required'),
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.formData = req.body;
    req.session.validationErrors = errors;
    return res.redirect('/add-admin'); 
  }

  const { name} = result.data;

  try {


    await prisma.artist.create({
      data: {
        name,
        status: 'active',
      },
    });


    req.session.success = 'Artist added successfully!';
    req.session.formData = {}; 
    req.session.validationErrors = {};
    return res.redirect('/add-artist'); 
  } catch (err) {
    console.error('Error adding artist:', err);
    req.session.error = 'An unexpected error occurred while adding the artist.';
    req.session.formData = req.body;
    return res.redirect('/add-artist'); 
  }
};

export const artists = async (req: Request, res: Response) => {
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


export const activateArtist = async (req: Request, res: Response) => {
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

export const deactivateArtist = async (req: Request, res: Response) => {
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


export const editArtistGet = async (req: Request, res: Response) => {
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
export const editArtistPost = async (req: Request, res: Response) => {
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
