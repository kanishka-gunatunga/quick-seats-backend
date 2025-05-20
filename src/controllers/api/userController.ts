import { Request, Response } from 'express';
import { prisma } from '../../prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET!;

export const register = async (req: Request, res: Response): Promise<void> => {
  const { email, password, first_name, last_name, contact_number, nic_passport, country } = req.body;

  try {
    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
      res.status(400).json({ message: 'User already exists' });
      return;
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

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  
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

  const user = await prisma.user.findUnique({ where: { email },include: { userDetails: true }, });
  if (!user) {
    res.status(400).json({ message: 'Invalid credentials' });
    return;
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    res.status(400).json({ message: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
    },
  });
};
