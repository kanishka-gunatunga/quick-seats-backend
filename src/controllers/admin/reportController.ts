import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();

export const orderReport = async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({ });

  const error = req.session.error;
  const success = req.session.success;
  req.session.error = undefined;
  req.session.success = undefined;

  res.render('reports/order-report', {
    error,
    success,
    orders,
  });
}; 

export const attendenceReport = async (req: Request, res: Response) => {
  const events = await prisma.event.findMany({ });

  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('reports/attendence-report', {
    error,
    success,
    events,
    formData,
    validationErrors,
  });
}; 
export const attendenceReportPost = async (req: Request, res: Response) => {
  const schema = z.object({
    event: z.string().min(1, 'Event ID is required'),
  });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.formData = req.body;
    req.session.validationErrors = errors;
    return res.redirect('/attendence-report');
  }

  const { event } = result.data;

  try {
    const eventId = Number(event);
    if (isNaN(eventId)) {
      req.session.error = 'Invalid Event ID provided.';
      req.session.formData = req.body;
      req.session.validationErrors = { event: ['Invalid Event ID'] };
      return res.redirect('/attendence-report');
    }

    // Fetch event details along with its attendees
    const eventDetails = await prisma.event.findUnique({
      where: { id: eventId }
    });

    if (!eventDetails) {
      req.session.error = 'Event not found.';
      req.session.formData = req.body;
      req.session.validationErrors = { event: ['Event not found'] };
      return res.redirect('/attendence-report');
    }

    // --- Generate Excel Report ---
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${eventDetails.name} Attendance Report`);

    // Add header row for event details
    worksheet.addRow(['Event Name', eventDetails.name]);
    worksheet.addRow(['Location', eventDetails.location]);
    worksheet.addRow(['Organized Date', eventDetails.start_date_time.toDateString()]); // Assuming organizedDate is a Date object


    // Set response headers for download
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${eventDetails.name.replace(/\s/g, '_')}_Attendance_Report.xlsx`
    );

    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (err) {
    console.error('Error generating attendance report:', err);
    req.session.error = 'An unexpected error occurred while generating the report.';
    req.session.formData = req.body;
    // Redirect to a more appropriate error page or the report page itself
    return res.redirect('/attendence-report');
  }
};