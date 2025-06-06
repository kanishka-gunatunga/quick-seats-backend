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

    const eventDetails = await prisma.event.findUnique({
      where: { id: eventId },
    });

    const ticketTypes = await prisma.ticketType.findMany({});

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
    worksheet.addRow(['Organized Date', eventDetails.start_date_time.toDateString()]);

    // --- Add Ticket Sales Summary Section ---

    // Explicitly cast eventDetails.ticket_details to an array
    const eventTicketDetails = (eventDetails.ticket_details || []) as Array<{
      price: number;
      ticketCount: number | null;
      ticketTypeId: number;
      hasTicketCount: boolean;
      bookedTicketCount: number;
    }>; // Added a more specific type for clarity, though `Array<any>` would also work

    // Map ticket types for easy lookup by ID
    const ticketTypeMap = new Map<number, string>();
    ticketTypes.forEach(type => {
      // If type.name is null, use an empty string instead
      ticketTypeMap.set(type.id, type.name || '');
    });

    // Filter and prepare ticket sales data for tickets with a defined count
    const ticketSalesData = eventTicketDetails
      .filter(detail => detail.hasTicketCount)
      .map(detail => ({
        ticketTypeName: ticketTypeMap.get(detail.ticketTypeId) || 'Unknown Ticket Type',
        availableTicketCount: detail.ticketCount,
        bookedTicketCount: detail.bookedTicketCount,
      }));

    // Add blank rows for visual separation
    worksheet.addRow([]);
    worksheet.addRow([]);

    // Add section header for Ticket Sales Summary
    const salesHeaderRow = worksheet.addRow(['Ticket Sales Summary']);
    salesHeaderRow.font = { bold: true, size: 14 };

    // Add column headers for ticket sales data
    worksheet.addRow(['Ticket Type', 'Available Tickets', 'Booked Tickets']);

    // Add actual ticket sales data rows
    ticketSalesData.forEach(data => {
      worksheet.addRow([
        data.ticketTypeName,
        data.availableTicketCount,
        data.bookedTicketCount,
      ]);
    });

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
    return res.redirect('/attendence-report');
  }
};