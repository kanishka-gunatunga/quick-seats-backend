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