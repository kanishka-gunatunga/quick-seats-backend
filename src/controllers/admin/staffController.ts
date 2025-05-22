import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

const prisma = new PrismaClient();

export const addStaffGet = async (req: Request, res: Response) => {
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('user/add-staff', {
    error,
    success,
    formData,
    validationErrors,
  });
};

export const addStaffPost = async (req: Request, res: Response) => {
  const schema = z
    .object({
      name: z.string().min(1, 'Name is required'),
      phone: z.string().min(1, 'Phone number is required'),
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
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.formData = req.body;
    req.session.validationErrors = errors;
    return res.redirect('/add-staff'); 
  }

  const { name, phone, email, password } = result.data;

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      req.session.error = 'Email already exists.';
      req.session.formData = req.body;
      req.session.validationErrors = {}; 
      return res.redirect('/add-staff'); 
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        user_role: 3,
        otp: null,
        status: 'active',
      },
    });

    await prisma.staffDetails.create({
      data: {
        user_id: user.id,
        name,
        phone,
      },
    });

    req.session.success = 'Staff member added successfully!';
    req.session.formData = {}; 
    req.session.validationErrors = {};
    return res.redirect('/add-staff'); 
  } catch (err) {
    console.error('Error adding staff member:', err);
    req.session.error = 'An unexpected error occurred while adding the staff member.';
    req.session.formData = req.body;
    return res.redirect('/add-staff'); 
  }
};

export const staffs = async (req: Request, res: Response) => {
  const staffs = await prisma.user.findMany({
    where: {
      user_role: 1,
    },
    include: {
      staffDetails: true,
    },
  });

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('user/staffs', {
    error,
    success,
    staffs,
  });
};


export const activateStaff = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.user.update({
      where: { id },
      data: { status: 'active' },
    });
    req.session.success = 'Staff Member activated successfully!';
  } catch (error) {
    console.error('Error activating admin:', error);
    req.session.error = 'Failed to activate admin. Please try again.';
  }
  return res.redirect('/staffs'); 
};

export const deactivateStaff = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.user.update({
      where: { id },
      data: { status: 'inactive' },
    });
    req.session.success = 'Staff Member deactivated successfully!';
  } catch (error) {
    console.error('Error deactivating admin:', error);
    req.session.error = 'Failed to deactivate admin. Please try again.';
  }
  return res.redirect('/staffs');
};


export const editStaffGet = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { adminDetails: true },
  });

  res.render('user/edit-admin', {
    error,
    success,
    formData,
    validationErrors,
    user,
  });
};
export const editStaffPost = async (req: Request, res: Response) => {
  const schema = z
    .object({
      name: z.string().min(1, 'Name is required'),
      phone: z.string().min(1, 'Phone number is required'),
      email: z.string().email('Invalid email format'),
      current_password: z.string().optional(),
      password: z.string().optional(),
      confirm_password: z.string().optional(),
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
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.validationErrors = errors;
    return res.redirect(`/admin/edit/${req.params.id}`);
  }

  const { name, phone, email, current_password, password } = result.data;
  const userId = parseInt(req.params.id);

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminDetails: true },
    });

    if (!user) {
      req.session.error = 'Admin not found.';
      return res.redirect('/admins');
    }

    if (password) {
      if (!current_password) {
        req.session.error = 'Current password is required to set a new password.';
        return res.redirect(`/admin/edit/${userId}`);
      }

      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        req.session.error = 'Current password is incorrect.';
        return res.redirect(`/admin/edit/${userId}`);
      }
    }


    if (email !== user.email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser && existingUser.id !== userId) {
        req.session.error = 'Email already exists.';
        return res.redirect(`/admin/edit/${userId}`);
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        email,
        ...(password ? { password: await bcrypt.hash(password, 10) } : {}),
      },
    });

    await prisma.adminDetails.update({
      where: { user_id: userId },
      data: {
        name,
        phone,
      },
    });

    req.session.success = 'Admin updated successfully!';
    req.session.validationErrors = {};
    return res.redirect(`/admin/edit/${userId}`);
  } catch (err) {
    console.error('Error updating admin:', err);
    req.session.error = 'An unexpected error occurred while updating the admin.';
    return res.redirect(`/admin/edit/${userId}`);
  }
};
