import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

export const loginGet = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;

  res.render('admin/login', { error, success, formData });
};

export const loginPost = async (req: Request, res: Response) => {
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1, "Password is required"),
  });

  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    req.session.error = 'Invalid input';
    req.session.formData = { email: req.body.email };
    return res.redirect('/');
  }

  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { adminDetails: true },
  });

  if (!user || user.user_role !== 1 || user.status !== 'active') {
    req.session.error = 'Access denied or user not found';
    req.session.formData = { email };
    return res.redirect('/');
  }

  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    req.session.error = 'Invalid password';
    req.session.formData = { email };
    return res.redirect('/');
  }

  req.session.admin = {
    id: user.id,
    email: user.email,
    name: user.adminDetails?.name || '',
    phone: user.adminDetails?.phone || '',
  };

  req.session.success = 'Login successful!';
  res.redirect('/dashboard');

  // const email = 'admin123@gmail.com';
  // const password = 'admin123';
  // const name = 'Royal Pratt';
  // const phone = '0111213215';
  //  const hashedPassword = await bcrypt.hash(password, 10);
  
  //     const user = await prisma.user.create({
  //       data: {
  //         email,
  //         password: hashedPassword,
  //         user_role: 1,
  //         otp: null,
  //         status: 'active',
  //       },
  //     });
  
  //     await prisma.adminDetails.create({
  //       data: {
  //         user_id: user.id,
  //         name,
  //         phone,
  //       },
  //     });
};

export const logout = (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).send('An error occurred while logging out.');
    }
    res.clearCookie('connect.sid'); 
    return res.redirect('/');
  });
};

export const dashboard = async (req: Request, res: Response) => {
  res.render('admin/dashboard');
};
