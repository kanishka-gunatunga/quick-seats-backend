import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

export const issueTickets = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;

  res.render('staff/ticket/issue', { error, success, formData });
};
