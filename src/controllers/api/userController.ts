import { Request, Response } from 'express';
import { prisma } from '../../prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import transporter from '../../services/mailTransporter';

const JWT_SECRET = process.env.JWT_SECRET!;

export const register = async (req: Request, res: Response) => {
    const schema = z
    .object({
      first_name: z.string().min(1, 'First name is required'),
      last_name: z.string().min(1, 'Last name is required'),
      contact_number: z.string().min(1, 'Contact number is required'),
      email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
      password: z.string().min(6, 'Password must be at least 6 characters'),
      confirm_password: z.string().min(1, 'Confirm password is required'),
      nic_passport: z.string().optional(),
      country: z.string().optional(),
    })
    .refine((data) => data.password === data.confirm_password, {
      path: ['confirm_password'],
      message: 'Passwords do not match',
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
  }
  const { email, password, confirm_password, first_name, last_name, contact_number, nic_passport, country } =  result.data;

  try {
    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        user_role: 2,
        otp: null,
        status: 'active',
      },
    });

    await prisma.userDetails.create({
      data: {
        user_id: user.id,
        first_name,
        last_name,
        contact_number,
        nic_passport,
        country
      },
    });

    return res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {

  // console.log('BODY:', req.body);
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1, "Password is required"),
  });

  const result = loginSchema.safeParse(req.body);

if (!result.success) {
  return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
}

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({ where: { email },include: { userDetails: true }, });
  if (!user) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
     return res.status(400).json({ message: 'Invalid credentials' });
   
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
    },
  });
};


export const updateProfileSettings = async (req: Request, res: Response) => {

  const userId = parseInt(req.params.id);

  const schema = z
    .object({
      first_name: z.string().min(1, 'First name is required'),
      last_name: z.string().min(1, 'Last name is required'),
      contact_number: z.string().min(1, 'Contact number is required'),
      email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
      nic_passport: z.string().optional(),
      country: z.string().optional(),
      gender: z.string().optional(),
      dob: z.preprocess(
      (val) => {
        if (typeof val === 'string' || val instanceof Date) {
          const date = new Date(val);
          return isNaN(date.getTime()) ? undefined : date;
        }
        return undefined;
      },
      z.date().optional()
    ),
      address_line1: z.string().optional(),
      address_line2: z.string().optional(),
      city: z.string().optional(),
    });


  const result = schema.safeParse(req.body);

  if (!result.success) {
  return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
  }

  const { first_name, last_name, contact_number, email, nic_passport, country, gender, dob, address_line1, address_line2, city } = result.data;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userDetails: true },
    });

    if (!user) {
       return res.status(400).json({ message: 'User not found.' });
    }

    if (email !== user.email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser && existingUser.id !== userId) {
         return res.status(400).json({ message: 'Email already exists.' });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        email
      },
    });

    await prisma.userDetails.update({
      where: { user_id: userId },
      data: {
        first_name,
        last_name,
        contact_number,
        nic_passport,
        country,
        gender,
        dob,
        address_line1,
        address_line2,
        city,
      },
    });

     return res.status(201).json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating admin:', err);
     return res.status(400).json({ message: 'An unexpected error occurred while updating the user.' });
  }
};

export const updateSecuritySettings = async (req: Request, res: Response) => {

  const userId = parseInt(req.params.id);

  const schema = z
    .object({
      old_password: z.string().min(1, 'Confirm password is required'),
      password: z.string().min(6, 'Password must be at least 6 characters'),
      confirm_password: z.string().min(1, 'Confirm password is required'),
    })
    .refine((data) => {
      if (data.password || data.confirm_password) {
        return data.password === data.confirm_password;
      }
      return true;
    }, {
      path: ['confirm_password'],
      message: 'Passwords do not match',
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
  return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
  }

  const {old_password, password } = result.data;

  try {

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userDetails: true },
    });

    if (!user) {
       return res.status(400).json({ message: 'User not found.' });
    }

    if (password) {

      const isMatch = await bcrypt.compare(old_password, user.password);
      if (!isMatch) {
         return res.status(400).json({ message: 'Current password is incorrect.' });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(password ? { password: await bcrypt.hash(password, 10) } : {}),
      },
    });

    return res.status(201).json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Error updating admin:', err);
    return res.status(400).json({ message: 'An unexpected error occurred while updating the user.' });
  }
};
export const bookingHistory = async (req: Request, res: Response) => {
  const userId = req.params.id;

  try {
    const orders = await prisma.order.findMany({
      where: { user_id: userId },
    });

    const bookingHistory = await Promise.all(
      orders.map(async (order) => {
        const event = await prisma.event.findUnique({
          where: { id: parseInt(order.event_id) },
        });

        if (!event) return null;

        const ticketCounts: { [key: string]: number } = {};
        
          if (Array.isArray(order.seat_ids)) {
            if (Array.isArray(event.seats)) {
              const seats = event.seats as Array<{ seatId: number; ticketTypeName: string }>;

              order.seat_ids.forEach((seatId) => {
                const seat = seats.find((s) => s.seatId === seatId);
                if (seat) {
                  if (!ticketCounts[seat.ticketTypeName]) {
                    ticketCounts[seat.ticketTypeName] = 1;
                  } else {
                    ticketCounts[seat.ticketTypeName]++;
                  }
                }
              });
            } else {
              console.warn(`Event seats is not an array for event ${event.id}`);
            }
          } else {
            console.warn(`Order ${order.id} seat_ids is not an array`);
          }

        const tickets = Object.entries(ticketCounts).map(([type, count]) => ({
          type,
          count,
        }));

        return {
          event_name: event.name,
          start_date_time: event.start_date_time,
          tickets,
        };
      })
    );

    return res.json({
      booking_history: bookingHistory.filter(Boolean), 
    });
  } catch (error) {
    console.error('Error fetching booking history:', error);
    return res.status(500).json({ message: 'Failed to fetch booking history' });
  }
};

export const paymentHistory = async (req: Request, res: Response) => {
  const userId = req.params.id;

  try {
    const orders = await prisma.order.findMany({ where: { user_id: userId } });

    return res.json({
      orders: orders,
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    return res.status(500).json({ message: 'Failed to fetch payment history' });
  }
};


export const getUserDetails = async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userDetails: true },
  });

  if (!user) {
    return res.status(400).json({ message: 'User not found' });
  }

  return res.json({
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    userDetails: {
      first_name: user.userDetails?.first_name,
      last_name: user.userDetails?.last_name,
      contact_number: user.userDetails?.contact_number,
      nic_passport: user.userDetails?.nic_passport,
      country: user.userDetails?.country,
      gender: user.userDetails?.gender,
      dob: user.userDetails?.dob,
      address_line1: user.userDetails?.address_line1,
      address_line2: user.userDetails?.address_line2,
      city: user.userDetails?.city,
    }
  });
};

export const forgotPassword = async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
  });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Invalid input',
      errors: result.error.flatten(),
    });
  }

  const { email } = result.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid email address.' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    await transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
      to: email,
      subject: 'Password Reset OTP',
      html: `<p>Your OTP for resetting your password is: <strong>${otp}</strong></p>`,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp: otp
      },
    });

    return res.status(200).json({ message: 'OTP sent to your email.' });
  } catch (err) {
    console.error('Error during forgot password process:', err);
    return res.status(500).json({ message: 'An unexpected error occurred.' });
  }
};


export const validateOtp = async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
    otp: z.string({ required_error: 'OTP is required' }),
  });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Invalid input',
      errors: result.error.flatten(),
    });
  }

  const { email, otp } = result.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.otp) {
      return res.status(400).json({ message: 'Invalid email address or OTP not requested.' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp: null,
      },
    });

    return res.status(200).json({ message: 'OTP validated successfully.' });
  } catch (err) {
    console.error('Error during OTP validation:', err);
    return res.status(500).json({ message: 'An unexpected error occurred.' });
  }
};


export const resetPassword = async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirm_password: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.password === data.confirm_password, {
      path: ['confirm_password'],
      message: 'Passwords do not match',
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: 'Invalid input',
      errors: result.error.flatten(),
    });
  }

  const { email, password } = result.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid email address.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
      },
    });

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Error during password update:', err);
    return res.status(500).json({ message: 'An unexpected error occurred.' });
  }
};