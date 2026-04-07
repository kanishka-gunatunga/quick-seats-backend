import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();

export const exportEventBookings = async (req: Request, res: Response) => {
    try {
        const eventId = req.params.eventId;

        if (!eventId) {
            return res.status(400).json({ message: 'Event ID is required.' });
        }

        const id = parseInt(eventId);
        if (isNaN(id)) {
            return res.status(400).json({ message: 'Invalid Event ID.' });
        }

        // 1. Fetch Event details
        const event = await prisma.event.findUnique({
            where: { id: id },
        });

        if (!event) {
            return res.status(404).json({ message: 'Event not found.' });
        }

        // 2. Fetch all completed/paid orders for this event
        const orders = await prisma.order.findMany({
            where: {
                event_id: eventId,
                status: 'completed',
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        if (orders.length === 0) {
            return res.status(404).json({ message: 'No completed bookings found for this event.' });
        }

        // 3. Fetch all ticket types once to use for lookup
        const allTicketTypes = await prisma.ticketType.findMany({});
        const ticketTypeMap = new Map(allTicketTypes.map(type => [type.id, type.name]));

        // 4. Prepare Excel workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bookings');

        // Define columns
        worksheet.columns = [
            { header: 'Order ID', key: 'id', width: 10 },
            { header: 'First Name', key: 'first_name', width: 20 },
            { header: 'Last Name', key: 'last_name', width: 20 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Contact Number', key: 'contact_number', width: 20 },
            { header: 'NIC/Passport', key: 'nic_passport', width: 20 },
            { header: 'Country', key: 'country', width: 15 },
            { header: 'Address', key: 'address', width: 25 },
            { header: 'City', key: 'city', width: 15 },
            { header: 'Booked Seats', key: 'booked_seats', width: 40 },
            { header: 'Tickets Without Seats', key: 'tickets_no_seats', width: 40 },
            { header: 'Total (LKR)', key: 'total', width: 15 },
            { header: 'Order Date', key: 'createdAt', width: 20 },
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };

        // 5. Populate Rows
        for (const order of orders) {
            // Process booked seats
            let bookedSeatsSummary = 'N/A';
            if (order.seat_ids && event.seats) {
                try {
                    const parsedSeatIds = typeof order.seat_ids === 'string' ? JSON.parse(order.seat_ids) : order.seat_ids;
                    const eventSeats = typeof event.seats === 'string' ? JSON.parse(event.seats as string) : event.seats;
                    
                    if (Array.isArray(parsedSeatIds) && Array.isArray(eventSeats)) {
                        const eventSeatsMap = new Map(eventSeats.map((s: any) => [s.seatId.toString(), s]));
                        const seatDetails = parsedSeatIds.map(sid => {
                            const seat = eventSeatsMap.get(sid.toString());
                            if (seat) {
                                const typeName = ticketTypeMap.get(seat.type_id) || 'Unknown';
                                return `${sid} (${typeName})`;
                            }
                            return sid;
                        });
                        bookedSeatsSummary = seatDetails.join('; ');
                    }
                } catch (e) {
                    console.error('Error parsing seats:', e);
                }
            }

            // Process tickets without seats
            let ticketsNoSeatsSummary = 'N/A';
            if (order.tickets_without_seats) {
                try {
                    const parsedTickets = typeof order.tickets_without_seats === 'string' ? JSON.parse(order.tickets_without_seats) : order.tickets_without_seats;
                    if (Array.isArray(parsedTickets)) {
                        const ticketDetails = parsedTickets.map((t: any) => {
                            const typeName = ticketTypeMap.get(t.ticket_type_id) || 'Unknown';
                            return `${t.ticket_count} x ${typeName}`;
                        });
                        ticketsNoSeatsSummary = ticketDetails.join('; ');
                    }
                } catch (e) {
                    console.error('Error parsing tickets without seats:', e);
                }
            }

            worksheet.addRow({
                id: order.id,
                first_name: order.first_name,
                last_name: order.last_name,
                email: order.email,
                contact_number: order.contact_number,
                nic_passport: order.nic_passport,
                country: order.country,
                address: order.address,
                city: order.city,
                booked_seats: bookedSeatsSummary,
                tickets_no_seats: ticketsNoSeatsSummary,
                total: order.total,
                createdAt: order.createdAt ? order.createdAt.toLocaleString() : '',
            });
        }

        // 6. Send Excel file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${event.name.replace(/\s+/g, '_')}_Bookings.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting bookings:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    } finally {
        await prisma.$disconnect();
    }
};
