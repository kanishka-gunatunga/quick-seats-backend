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

    // Fetch event details including ticket_details and seats
    const eventDetails = await prisma.event.findUnique({
      where: { id: eventId },
      // If ticket_details and seats are relations, you might need to include them:
      // include: {
      //   ticketDetails: true, // Adjust to your relation name
      //   seats: true,         // Adjust to your relation name
      // }
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

    // --- Process Ticket Details (for tickets without specific seats) ---
    let eventTicketDetails: Array<{
      price: number;
      ticketCount: number | null;
      ticketTypeId: number;
      hasTicketCount: boolean;
      bookedTicketCount: number;
    }> = [];

    if (eventDetails.ticket_details) {
      if (Array.isArray(eventDetails.ticket_details)) {
        eventTicketDetails = eventDetails.ticket_details as Array<any>;
      } else if (typeof eventDetails.ticket_details === 'string') {
        try {
          const parsedDetails = JSON.parse(eventDetails.ticket_details);
          if (Array.isArray(parsedDetails)) {
            eventTicketDetails = parsedDetails;
          } else {
            console.warn('eventDetails.ticket_details was a string but not a valid JSON array.');
          }
        } catch (parseError) {
          console.error('Error parsing ticket_details JSON:', parseError);
          eventTicketDetails = [];
        }
      }
    }

    // Map ticket types for easy lookup by ID
    const ticketTypeMap = new Map<number, string>();
    ticketTypes.forEach(type => {
      ticketTypeMap.set(type.id, type.name || ''); // Handle null names
    });

    // Filter and prepare ticket sales data for tickets with a defined count (seated tickets implicitly handled by event.seats)
    const ticketSalesData = eventTicketDetails
      .filter(detail => detail.hasTicketCount) // These are the tickets with specific quantity limits, but NOT individual seats
      .map(detail => ({
        ticketTypeName: ticketTypeMap.get(detail.ticketTypeId) || 'Unknown Ticket Type',
        availableTicketCount: detail.ticketCount,
        bookedTicketCount: detail.bookedTicketCount,
      }));

    // --- Process Seats Data ---
    let eventSeats: Array<{
      color: string;
      price: number;
      seatId: string;
      status: 'available' | 'booked' | 'issued' | 'unavailable' | string; // Extend with expected statuses
      type_id: number;
      ticketTypeName: string;
    }> = [];

    if (eventDetails.seats) {
      if (Array.isArray(eventDetails.seats)) {
        eventSeats = eventDetails.seats as Array<any>;
      } else if (typeof eventDetails.seats === 'string') {
        try {
          const parsedSeats = JSON.parse(eventDetails.seats);
          if (Array.isArray(parsedSeats)) {
            eventSeats = parsedSeats;
          } else {
            console.warn('eventDetails.seats was a string but not a valid JSON array.');
          }
        } catch (parseError) {
          console.error('Error parsing seats JSON:', parseError);
          eventSeats = [];
        }
      }
    }

    // Calculate seat counts based on status
    let bookedSeatsCount = 0;
    let issuedSeatsCount = 0;
    let notBookedSeatsCount = 0; // This will cover all seats that are not 'booked' or 'issued'

    eventSeats.forEach(seat => {
      if (seat.status === 'booked') {
        bookedSeatsCount++;
      } else if (seat.status === 'issued') {
        issuedSeatsCount++;
      } else {
        notBookedSeatsCount++; // This includes 'unavailable' and any other non-booked/non-issued status
      }
    });

    const totalSeatsJsonSize = JSON.stringify(eventSeats).length; // Size in bytes

    // --- Add Ticket Sales Summary Section (for tickets with defined count, but no individual seats) ---
    worksheet.addRow([]);
    worksheet.addRow([]);
    const salesHeaderRow = worksheet.addRow(['Ticket Sales Summary (Tickets without individual seats)']);
    salesHeaderRow.font = { bold: true, size: 14 };

    worksheet.addRow(['Ticket Type', 'Available Tickets', 'Booked Tickets']);
    ticketSalesData.forEach(data => {
      worksheet.addRow([
        data.ticketTypeName,
        data.availableTicketCount,
        data.bookedTicketCount,
      ]);
    });

    // --- Add Seat Distribution Summary Section (for tickets with individual seats) ---
    worksheet.addRow([]);
    worksheet.addRow([]);
    const seatHeaderRow = worksheet.addRow(['Seat Distribution Summary (Tickets with individual seats)']);
    seatHeaderRow.font = { bold: true, size: 14 };

    worksheet.addRow(['Total Seats', eventSeats.length]);
    worksheet.addRow(['Booked Seats', bookedSeatsCount]);
    worksheet.addRow(['Issued Seats', issuedSeatsCount]);
    worksheet.addRow(['Other (Not Booked/Issued) Seats', notBookedSeatsCount]);



    // --- Add Overall Ticket Count Summary ---
    worksheet.addRow([]);
    worksheet.addRow([]);
    const overallHeaderRow = worksheet.addRow(['Overall Ticket Count Summary']);
    overallHeaderRow.font = { bold: true, size: 14 };

    const ticketsWithoutSeatsCount = eventTicketDetails
        .filter(detail => !detail.hasTicketCount) // These are the tickets that do NOT have a specific seat assigned
        .reduce((sum, detail) => sum + detail.bookedTicketCount, 0);

    worksheet.addRow(['Tickets with Individual Seats (Total)', eventSeats.length]);
    worksheet.addRow(['Tickets without Individual Seats (Booked Count)', ticketsWithoutSeatsCount]);


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

export const salesReport = async (req: Request, res: Response) => {
  const events = await prisma.event.findMany({ });

  const error = req.session.error;
  const success = req.session.success;
  const formData = req.session.formData || {};
  const validationErrors = req.session.validationErrors || {};

  req.session.error = undefined;
  req.session.success = undefined;
  req.session.formData = undefined;
  req.session.validationErrors = undefined;

  res.render('reports/sales-report', {
    error,
    success,
    events,
    formData,
    validationErrors,
  });
}; 



export const salesReportPost = async (req: Request, res: Response) => {
  // Define the schema for validation. All fields are optional as per the requirement.
  const schema = z.object({
    event: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  });

  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    req.session.error = 'Please fix the errors below.';
    req.session.formData = req.body;
    req.session.validationErrors = errors;
    return res.redirect('/sales-report');
  }

  const { event, start_date, end_date } = result.data;

  try {
    const whereClause: any = {};

    // Build the where clause for Prisma query based on provided filters
    if (event && event !== 'Select....') { // Assuming 'Select....' is the default option value
      const eventId = Number(event);
      if (!isNaN(eventId)) {
        whereClause.event_id = eventId.toString(); // Assuming event_id in Order model is String
      } else {
        req.session.error = 'Invalid Event selection.';
        req.session.formData = req.body;
        req.session.validationErrors = { event: ['Invalid Event ID'] };
        return res.redirect('/sales-report');
      }
    }

    if (start_date || end_date) {
      whereClause.createdAt = {};
      if (start_date) {
        whereClause.createdAt.gte = new Date(start_date);
      }
      if (end_date) {
        // To include the entire end_date day, set the time to the end of the day
        const endDateObj = new Date(end_date);
        endDateObj.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = endDateObj;
      }
    }

    // Fetch orders based on the filters
    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (orders.length === 0) {
      req.session.error = 'No orders found for the selected criteria.';
      req.session.formData = req.body;
      return res.redirect('/sales-report');
    }

    // --- Generate Excel Report ---
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders Report');

    // Define columns for the Excel sheet
    worksheet.columns = [
      { header: 'Order ID', key: 'id'},
      { header: 'Email', key: 'email'},
      { header: 'First Name', key: 'first_name'},
      { header: 'Last Name', key: 'last_name'},
      { header: 'Contact Number', key: 'contact_number'},
      { header: 'NIC/Passport', key: 'nic_passport'},
      { header: 'Country', key: 'country'},
      { header: 'Event', key: 'Event'},
      { header: 'Customer', key: 'Customer'},
      { header: 'Sub Total', key: 'sub_total'},
      { header: 'Discount', key: 'discount'},
      { header: 'Total', key: 'total'},
      { header: 'Status', key: 'status'},
      { header: 'Order Date', key: 'createdAt'},
    ];

    
    for (const order of orders) { 
      const eventDetails = await prisma.event.findUnique({
        where: { id: Number(order.event_id) },
      });
      const user = await prisma.userDetails.findUnique({
        where: { id: Number(order.user_id) },
      });
      worksheet.addRow({
        id: order.id,
        email: order.email,
        first_name: order.first_name,
        last_name: order.last_name,
        contact_number: order.contact_number,
        nic_passport: order.nic_passport,
        country: order.country,
        Event: eventDetails?.name, 
        Customer: user?.first_name + ' ' + user?.last_name,
        sub_total: order.sub_total,
        discount: order.discount,
        total: order.total,
        status: order.status,
        createdAt: order.createdAt ? order.createdAt.toLocaleString() : '', // Format date
      });
    }

    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=orders_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error generating orders report:', err);
    req.session.error = 'An unexpected error occurred while generating the report.';
    req.session.formData = req.body;
    return res.redirect('/sales-report'); // Redirect back to the sales report page
  } finally {
    await prisma.$disconnect(); // Disconnect Prisma client
  }
};