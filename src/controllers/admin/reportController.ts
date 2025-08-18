import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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
        format: z.enum(['excel', 'pdf']), // Add the format validation
    });

    const result = schema.safeParse(req.body);

    if (!result.success) {
        const errors = result.error.flatten().fieldErrors;
        req.session.error = 'Please fix the errors below.';
        req.session.formData = req.body;
        req.session.validationErrors = errors;
        return res.redirect('/attendence-report');
    }

    const { event, format } = result.data;

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

        // --- Data Processing (re-usable for both formats) ---
        let eventTicketDetails: Array<any> = [];
        if (eventDetails.ticket_details) {
            try {
                eventTicketDetails = JSON.parse(eventDetails.ticket_details as string);
            } catch (e) {
                console.error('Error parsing ticket_details:', e);
            }
        }

        const ticketTypeMap = new Map<number, string>();
        ticketTypes.forEach(type => {
            ticketTypeMap.set(type.id, type.name || 'Unknown');
        });

        const ticketSalesData = eventTicketDetails
            .filter(detail => detail.hasTicketCount)
            .map(detail => ({
                ticketTypeName: ticketTypeMap.get(detail.ticketTypeId) || 'Unknown Ticket Type',
                availableTicketCount: detail.ticketCount,
                bookedTicketCount: detail.bookedTicketCount,
            }));
        
        const ticketsWithoutSeatsCount = eventTicketDetails
            .filter(detail => !detail.hasTicketCount)
            .reduce((sum, detail) => sum + detail.bookedTicketCount, 0);

        let eventSeats: Array<any> = [];
        if (eventDetails.seats) {
            try {
                eventSeats = JSON.parse(eventDetails.seats as string);
            } catch (e) {
                console.error('Error parsing seats JSON:', e);
            }
        }

        let bookedSeatsCount = 0;
        let issuedSeatsCount = 0;
        let notBookedSeatsCount = 0;

        eventSeats.forEach(seat => {
            if (seat.status === 'booked') {
                bookedSeatsCount++;
            } else if (seat.status === 'issued') {
                issuedSeatsCount++;
            } else {
                notBookedSeatsCount++;
            }
        });

        // --- Conditional Output Generation ---
        if (format === 'excel') {
            // Your existing Excel generation logic here
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(`${eventDetails.name} Attendance Report`);

            worksheet.addRow(['Event Name', eventDetails.name]);
            worksheet.addRow(['Location', eventDetails.location]);
            worksheet.addRow(['Organized Date', eventDetails.start_date_time.toDateString()]);

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

            worksheet.addRow([]);
            worksheet.addRow([]);
            const seatHeaderRow = worksheet.addRow(['Seat Distribution Summary (Tickets with individual seats)']);
            seatHeaderRow.font = { bold: true, size: 14 };

            worksheet.addRow(['Total Seats', eventSeats.length]);
            worksheet.addRow(['Booked Seats', bookedSeatsCount]);
            worksheet.addRow(['Issued Seats', issuedSeatsCount]);
            worksheet.addRow(['Other (Not Booked/Issued) Seats', notBookedSeatsCount]);

            worksheet.addRow([]);
            worksheet.addRow([]);
            const overallHeaderRow = worksheet.addRow(['Overall Ticket Count Summary']);
            overallHeaderRow.font = { bold: true, size: 14 };

            worksheet.addRow(['Tickets with Individual Seats (Total)', eventSeats.length]);
            worksheet.addRow(['Tickets without Individual Seats (Booked Count)', ticketsWithoutSeatsCount]);

            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=${eventDetails.name.replace(/\s/g, '_')}_Attendance_Report.xlsx`
            );
            await workbook.xlsx.write(res);
            res.end();

        } else if (format === 'pdf') {
            // New PDF generation logic
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage();
            const { width, height } = page.getSize();
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            
            let y = height - 50;
            const margin = 50;
            const fontSize = 12;

            const drawText = (text: string, x: number, yPos: number, options = {}) => {
                page.drawText(text, {
                    x,
                    y: yPos,
                    font,
                    size: fontSize,
                    color: rgb(0, 0, 0),
                    ...options
                });
            };

            const addTitle = (title: string) => {
                drawText(title, margin, y, { size: 18, font, color: rgb(0, 0, 0.5) });
                y -= 25;
            };

            const addSectionHeader = (header: string) => {
                y -= 20;
                drawText(header, margin, y, { size: 14, font, color: rgb(0.2, 0.2, 0.2) });
                y -= 15;
            };

            // Event Details
            addTitle(`${eventDetails.name} Attendance Report`);
            drawText(`Location: ${eventDetails.location}`, margin, y);
            y -= 20;
            drawText(`Organized Date: ${eventDetails.start_date_time.toDateString()}`, margin, y);
            y -= 30;

            // Ticket Sales Summary
            addSectionHeader('Ticket Sales Summary (Tickets without individual seats)');
            drawText('Ticket Type', margin, y);
            drawText('Available Tickets', margin + 200, y);
            drawText('Booked Tickets', margin + 400, y);
            y -= 15;

            ticketSalesData.forEach(data => {
                drawText(data.ticketTypeName, margin, y);
                drawText(String(data.availableTicketCount), margin + 200, y);
                drawText(String(data.bookedTicketCount), margin + 400, y);
                y -= 15;
            });

            // Seat Distribution Summary
            addSectionHeader('Seat Distribution Summary (Tickets with individual seats)');
            drawText('Total Seats:', margin, y);
            drawText(String(eventSeats.length), margin + 200, y);
            y -= 15;
            drawText('Booked Seats:', margin, y);
            drawText(String(bookedSeatsCount), margin + 200, y);
            y -= 15;
            drawText('Issued Seats:', margin, y);
            drawText(String(issuedSeatsCount), margin + 200, y);
            y -= 15;
            drawText('Other (Not Booked/Issued):', margin, y);
            drawText(String(notBookedSeatsCount), margin + 200, y);
            y -= 30;

            // Overall Ticket Count Summary
            addSectionHeader('Overall Ticket Count Summary');
            drawText('Tickets with Individual Seats (Total):', margin, y);
            drawText(String(eventSeats.length), margin + 250, y);
            y -= 15;
            drawText('Tickets without Individual Seats (Booked Count):', margin, y);
            drawText(String(ticketsWithoutSeatsCount), margin + 250, y);
            
            const pdfBytes = await pdfDoc.save();

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename=${eventDetails.name.replace(/\s/g, '_')}_Attendance_Report.pdf`
            );
            res.send(Buffer.from(pdfBytes));

        } else {
            // Handle an invalid format choice
            req.session.error = 'Invalid report format selected.';
            req.session.formData = req.body;
            req.session.validationErrors = { format: ['Invalid format'] };
            return res.redirect('/attendence-report');
        }

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
        // Assuming event_id in Order model is of type String but refers to an Int ID in Event model
        whereClause.event_id = eventId.toString();
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

    // Fetch orders based on the filters without including relations
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

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders Report');

    // Define columns for the Excel sheet
    worksheet.columns = [
      { header: 'Order ID', key: 'id', width: 15 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'First Name', key: 'first_name', width: 20 },
      { header: 'Last Name', key: 'last_name', width: 20 },
      { header: 'Contact Number', key: 'contact_number', width: 20 },
      { header: 'NIC/Passport', key: 'nic_passport', width: 20 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Event', key: 'Event', width: 25 },
      { header: 'Customer', key: 'Customer', width: 25 },
      { header: 'Booked Seats', key: 'booked_seats', width: 40 }, // New column for seats
      { header: 'Tickets Without Seats', key: 'tickets_without_seats_summary', width: 40 }, // New column for tickets without seats
      { header: 'Sub Total', key: 'sub_total', width: 15 },
      { header: 'Discount', key: 'discount', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Order Date', key: 'createdAt', width: 20 },
    ];

    // Fetch all ticket types once to use for lookup
    const allTicketTypes = await prisma.ticketType.findMany({});
    const ticketTypeMap = new Map(allTicketTypes.map(type => [type.id, type.name]));
    let overallTotal = 0;

    for (const order of orders) {
      // Manually fetch event details for each order
      const eventDetails = await prisma.event.findUnique({
        where: { id: Number(order.event_id) }, // Convert event_id to a number for lookup
      });

      // Manually fetch user details for each order
      const user = await prisma.userDetails.findUnique({
        where: { id: Number(order.user_id) }, // Convert user_id to a number for lookup
      });

      // --- CRUCIAL FIX: Safely parse ALL JSON fields that are arrays ---

      // Process order.seat_ids
      let parsedOrderSeatIds: string[] | null = null;
      if (order.seat_ids) {
        if (typeof order.seat_ids === 'string') {
          try {
            parsedOrderSeatIds = JSON.parse(order.seat_ids);
          } catch (parseError) {
            console.error('Error parsing order.seat_ids JSON string:', parseError);
            parsedOrderSeatIds = null;
          }
        } else if (Array.isArray(order.seat_ids)) {
          parsedOrderSeatIds = order.seat_ids as string[];
        }
      }

      // Process order.tickets_without_seats
      let parsedTicketsWithoutSeats: Array<{ ticket_type_id: number; ticket_count: number }> | null = null;
      if (order.tickets_without_seats) {
        if (typeof order.tickets_without_seats === 'string') {
          try {
            parsedTicketsWithoutSeats = JSON.parse(order.tickets_without_seats);
          } catch (parseError) {
            console.error('Error parsing order.tickets_without_seats JSON string:', parseError);
            parsedTicketsWithoutSeats = null;
          }
        } else if (Array.isArray(order.tickets_without_seats)) {
          parsedTicketsWithoutSeats = order.tickets_without_seats as Array<{ ticket_type_id: number; ticket_count: number }>;
        }
      }

      // Process eventDetails.seats
      let processedEventSeats: any[] | null = null;
      if (eventDetails?.seats) {
        if (typeof eventDetails.seats === 'string') {
          try {
            processedEventSeats = JSON.parse(eventDetails.seats);
          } catch (parseError) {
            console.error('Error parsing eventDetails.seats JSON string:', parseError);
            processedEventSeats = null;
          }
        } else if (Array.isArray(eventDetails.seats)) {
          processedEventSeats = eventDetails.seats;
        }
      }
      // --- End CRUCIAL FIX ---


      // Process booked seats
      let bookedSeatsSummary = 'N/A';
      // Use parsedOrderSeatIds and processedEventSeats in the condition
      if (parsedOrderSeatIds && Array.isArray(parsedOrderSeatIds) && processedEventSeats && Array.isArray(processedEventSeats)) {
        const seatIdsArray: string[] = parsedOrderSeatIds; // Use the parsed array
        const eventSeatsMap = new Map(
          (processedEventSeats as Array<any>).map((seat: any) => [seat.seatId, seat])
        );

        const seatDetails: string[] = [];
        for (const seatId of seatIdsArray) {
          const seat = eventSeatsMap.get(seatId);
          if (seat) {
            const ticketTypeName = ticketTypeMap.get(seat.type_id) || 'Unknown Type';
            seatDetails.push(`${seatId} (${ticketTypeName})`);
          }
        }
        if (seatDetails.length > 0) {
          bookedSeatsSummary = seatDetails.join('; ');
        } else {
          bookedSeatsSummary = 'No seats found';
        }
      }

      // Process tickets without seats
      let ticketsWithoutSeatsSummary = 'N/A';
      // Use parsedTicketsWithoutSeats in the condition
      if (parsedTicketsWithoutSeats && Array.isArray(parsedTicketsWithoutSeats)) {
        const ticketDetails: string[] = [];
        for (const ticket of parsedTicketsWithoutSeats) { // Use the parsed array
          const ticketTypeName = ticketTypeMap.get(ticket.ticket_type_id) || 'Unknown Type';
          ticketDetails.push(`${ticket.ticket_count} x ${ticketTypeName}`);
        }
        if (ticketDetails.length > 0) {
          ticketsWithoutSeatsSummary = ticketDetails.join('; ');
        } else {
          ticketsWithoutSeatsSummary = 'No tickets without seats found';
        }
      }

      worksheet.addRow({
        id: order.id,
        email: order.email,
        first_name: order.first_name,
        last_name: order.last_name,
        contact_number: order.contact_number,
        nic_passport: order.nic_passport,
        country: order.country,
        Event: eventDetails?.name, // Use optional chaining in case eventDetails is null
        Customer: user ? `${user.first_name} ${user.last_name}` : 'N/A', // Use ternary for customer name
        booked_seats: bookedSeatsSummary,
        tickets_without_seats_summary: ticketsWithoutSeatsSummary,
        sub_total: order.sub_total,
        discount: order.discount,
        total: order.total,
        status: order.status,
        createdAt: order.createdAt ? order.createdAt.toLocaleString() : '', // Format date
      });

      overallTotal += order.total;
    }

    worksheet.addRow({}); // Add an empty row for spacing
    worksheet.addRow({
      id: 'Overall Total:',
      total: overallTotal,
    });
    worksheet.getCell('B' + worksheet.rowCount).font = { bold: true }; // Make "Overall Total" bold
    worksheet.getCell('O' + worksheet.rowCount).font = { bold: true }; // Make the total value bold
    
    // Set response headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=orders_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error generating sales report:', err);
    req.session.error = 'An unexpected error occurred while generating the report.';
    req.session.formData = req.body;
    return res.redirect('/sales-report');
  } finally {
    await prisma.$disconnect(); // Disconnect Prisma client
  }
};