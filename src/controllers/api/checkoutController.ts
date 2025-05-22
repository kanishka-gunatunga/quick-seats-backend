import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import QRCode from 'qrcode';

const prisma = new PrismaClient();

export const checkout = async (req: Request, res: Response) => {
    const schema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  contact_number: z.string().min(1, 'Contact number is required'),
  email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
  nic_passport: z.string().min(1, 'NIC/Passport is required'),
  country: z.string().min(1, 'Country is required'),
  event_id: z.string().min(1, 'Event id is required'),
  user_id: z.string().min(1, 'User id is required'),
  seat_ids: z.preprocess((val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return [];
      }
    }
    return val;
  }, z.array(z.union([z.number(), z.string()])).min(1, 'At least one seat must be selected')),

});

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
  }
  const { email, first_name, last_name, contact_number, nic_passport, country, event_id, user_id, seat_ids } =  result.data;

  try {

    const order = await prisma.order.create({
      data: {
        email,
        first_name,
        last_name,
        contact_number,
        nic_passport,
        country,
        event_id,
        user_id,
        seat_ids,
        sub_total:1000,
        discount:0,
        total:1000,
        status:'pending'
      },
    });

    const qrData = `https://yourdomain.com/order/${order.id}`; // or just order.id
    const qrCode = await QRCode.toDataURL(qrData);

    return res.status(201).json({
      message: 'Order created successfully',
      order_id: order.id,
      qr_code: qrCode, 
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};