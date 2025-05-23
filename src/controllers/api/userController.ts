import { Request, Response } from 'express';
import { prisma } from '../../prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

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
