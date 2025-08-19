import { Request, Response } from 'express';
import { prisma } from '../../prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import transporter from '../../services/mailTransporter';
import ejs from 'ejs';
import path from 'path';
import axios from 'axios';

export const inquiry = async (req: Request, res: Response) => {
    const schema = z
    .object({
      first_name: z.string().min(1, 'First name is required'),
      last_name: z.string().min(1, 'Last name is required'),
      phone_number: z.string().min(1, 'Contact number is required'),
      email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
      subject: z.string().min(1, 'Subject is required'),
      message: z.string().optional(),
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
  }
  const { email, first_name, last_name, phone_number, subject, message } =  result.data;

  try {
    
    const templatePath = path.join(__dirname, '../../views/email-templates/inquiry-email-template.ejs');
    const emailHtml = await ejs.renderFile(templatePath, {
        email: email,
        first_name: first_name,
        last_name: last_name,
        phone_number: phone_number,
        subject: subject,
        message: message,
    });
    
    await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to: 'kasupamu300@gmail.com',
        subject: 'New Inquiry Form Submission',
        html: emailHtml,
    });

    
    return res.status(201).json({ message: 'Inquiry submited successfully.' });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};


export const newsletter = async (req: Request, res: Response) => {
    const schema = z
    .object({
      email: z.string({ required_error: 'Email is required' }).email('Invalid email format'),
    });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
    message: 'Invalid input',
    errors: result.error.flatten(),
  });
  }
  const { email} =  result.data;

  try {
    
    const templatePath = path.join(__dirname, '../../views/email-templates/newsletter-email-template.ejs');
    const emailHtml = await ejs.renderFile(templatePath, {
        email: email,
    });
    
    await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_ADDRESS}>`,
        to: 'kasupamu300@gmail.com',
        subject: 'New Newsletter Submission',
        html: emailHtml,
    });

    
    return res.status(201).json({ message: 'Newsletter submited successfully.' });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
