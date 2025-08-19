import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();
export const getAllEvents = async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      artistId,
      location,
      minPrice,
      maxPrice
    } = req.query;

    // Step 1: Get all active events
    let events = await prisma.event.findMany({
      where: {
        status: 'active',
        ...(location && { location: String(location) }),
        start_date_time: {
          gt: new Date(),
          ...(startDate && endDate && {
            gte: new Date(String(startDate)),
            lte: new Date(String(endDate)),
          })
        }
      }
    });

    // Step 2: Filter by artist (if artistId is provided)
    if (artistId) {
      const filterArtistIds = String(artistId).split(',').map(Number);
      events = events.filter(event => {
        const eventArtistIds = Array.isArray(event.artist_details)
          ? event.artist_details.map(Number)
          : [];
        return eventArtistIds.some(id => filterArtistIds.includes(id));
      });
    }

    // Step 3: Filter by price range (if given)
    if (minPrice || maxPrice) {
      const min = Number(minPrice) || 0;
      const max = Number(maxPrice) || Infinity;

      events = events.filter(event => {
        // Corrected logic: Safely parse the ticket_details JSON string
        const tickets: any[] = (() => {
          if (!event.ticket_details) return [];
          if (Array.isArray(event.ticket_details)) return event.ticket_details;
          try {
            return JSON.parse(event.ticket_details as any);
          } catch (err) {
            console.error("Invalid ticket_details format during filtering", err);
            return [];
          }
        })();

        // Now, you can correctly filter the parsed tickets
        return tickets.some(ticket => ticket.price >= min && ticket.price <= max);
      });
    }

    // Step 4: Enrich each event with artists and ticket types
    const enhancedEvents = await Promise.all(events.map(async (event) => {
      const artistIds: number[] = Array.isArray(event.artist_details)
        ? event.artist_details.map(Number)
        : [];

      const ticketDetails: any[] = (() => {
        if (!event.ticket_details) return [];
        if (Array.isArray(event.ticket_details)) return event.ticket_details;
        try {
          return JSON.parse(event.ticket_details as any);
        } catch (err) {
          console.error("Invalid ticket_details format", err);
          return [];
        }
      })();

      const seats: any[] = (() => {
        if (!event.seats) return [];
        if (Array.isArray(event.seats)) return event.seats;
        try {
          return JSON.parse(event.seats as any);
        } catch (err) {
          console.error("Invalid seats format", err);
          return [];
        }
      })();

      const artists = await prisma.artist.findMany({
        where: { id: { in: artistIds } }
      });

      const ticketTypeIds = ticketDetails.map(t => t.ticketTypeId);
      const ticketTypes = await prisma.ticketType.findMany({
        where: { id: { in: ticketTypeIds } }
      });

      const enrichedTickets = ticketDetails.map(ticket => {
        const ticketType = ticketTypes.find(tt => tt.id === ticket.ticketTypeId);
        return {
          ...ticket,
          ticketTypeName: ticketType?.name || 'Unknown'
        };
      });

      const enrichedArtists = artistIds.map(id => {
        const artist = artists.find(a => a.id === id);
        return {
          artistId: id,
          artistName: artist?.name || 'Unknown'
        };
      });

      let all_seats_booked = 0;
      if (seats.length > 0 && seats.every(seat => seat.status === "booked")) {
        all_seats_booked = 1;
      }

      let all_ticket_without_seats_booked = 0;
      if (
        ticketDetails.length > 0 &&
        ticketDetails.every(ticket =>
          ticket.hasTicketCount === true &&
          ticket.bookedTicketCount >= ticket.ticketCount
        )
      ) {
        all_ticket_without_seats_booked = 1;
      }

      return {
        ...event,
        ticket_details: enrichedTickets,
        artist_details: enrichedArtists,
        all_seats_booked,
        all_ticket_without_seats_booked
      };
    }));

    return res.json({ events: enhancedEvents });

  } catch (error) {
    console.error('Error fetching events:', error);
    return res.status(500).json({ message: 'Failed to fetch events.' });
  }
};

export const getTrendingEvents = async (req: Request, res: Response) => {
  // 1. Fetch all active events
  const allActiveEvents = await prisma.event.findMany({
  where: {
    status: 'active',
    start_date_time: {
      gt: new Date(),
    },
  },
});
  // 2. For each event, count the associated orders
  const eventsWithOrderCounts = await Promise.all(
    allActiveEvents.map(async (event) => {
      const orderCount = await prisma.order.count({
        where: {
          event_id: String(event.id), // Assuming 'eventId' column in your 'Order' table
        },
      });
      return {
        ...event,
        orderCount: orderCount,
      };
    })
  );

  // 3. Sort events by order count in descending order and take the top 8
  const sortedEvents = eventsWithOrderCounts.sort(
    (a, b) => b.orderCount - a.orderCount
  );

  const top8Events = sortedEvents.slice(0, 8);

  // 4. Enhance the top 8 events with artist and ticket details
  const enhancedEvents = await Promise.all(
    top8Events.map(async (event) => {
      const artistIds: number[] = Array.isArray(event.artist_details)
        ? (event.artist_details as any[]).map(Number)
        : [];

      const ticketDetails: any[] = (() => {
      if (!event.ticket_details) return [];
      if (Array.isArray(event.ticket_details)) return event.ticket_details;
      try {
        return JSON.parse(event.ticket_details as any);
      } catch (err) {
        console.error("Invalid ticket_details format", err);
        return [];
      }
      })();

      const seats: any[] = (() => {
        if (!event.seats) return [];
        if (Array.isArray(event.seats)) return event.seats;
        try {
          return JSON.parse(event.seats as any);
        } catch (err) {
          console.error("Invalid seats format", err);
          return [];
        }
      })();

      const artists = await prisma.artist.findMany({
        where: { id: { in: artistIds } },
      });

      const ticketTypeIds = ticketDetails.map((t) => t.ticketTypeId);
      const ticketTypes = await prisma.ticketType.findMany({
        where: { id: { in: ticketTypeIds } },
      });

      const enrichedTickets = ticketDetails.map((ticket) => {
        const ticketType = ticketTypes.find((tt) => tt.id === ticket.ticketTypeId);
        return {
          ...ticket,
          ticketTypeName: ticketType?.name || 'Unknown',
        };
      });

      const enrichedArtists = artistIds.map((id) => {
        const artist = artists.find((a) => a.id === id);
        return {
          artistId: id,
          artistName: artist?.name || 'Unknown',
        };
      });

      // Remove the temporary 'orderCount' property if you don't want it in the final response
      const { orderCount, ...eventWithoutOrderCount } = event;

       let all_seats_booked = 0;
      if (seats.length > 0 && seats.every(seat => seat.status === "booked")) {
        all_seats_booked = 1;
      }

      let all_ticket_without_seats_booked = 0;
      if (
        ticketDetails.length > 0 &&
        ticketDetails.every(ticket =>
          ticket.hasTicketCount === true &&
          ticket.bookedTicketCount >= ticket.ticketCount
        )
      ) {
        all_ticket_without_seats_booked = 1;
      }

      return {
        ...eventWithoutOrderCount,
        ticket_details: enrichedTickets,
        artist_details: enrichedArtists,
        orderCount: orderCount, // Keep orderCount if you want to expose it
        all_seats_booked,
        all_ticket_without_seats_booked
      };
    })
  );

  return res.json({
    events: enhancedEvents,
  });
};

export const getUpcomingEvents = async (req: Request, res: Response) => {
  const currentDate = new Date();

  const events = await prisma.event.findMany({
    where: {
      status: 'active',
      start_date_time: {
        gt: currentDate,
      },
    },
    orderBy: {
      start_date_time: 'asc',
    },
    take: 8,
  });

   const enhancedEvents = await Promise.all(events.map(async (event) => {

    const artistIds: number[] = Array.isArray(event.artist_details)
      ? event.artist_details.map(Number)
      : [];

    const ticketDetails: any[] = (() => {
      if (!event.ticket_details) return [];
      if (Array.isArray(event.ticket_details)) return event.ticket_details;
      try {
        return JSON.parse(event.ticket_details as any);
      } catch (err) {
        console.error("Invalid ticket_details format", err);
        return [];
      }
      })();

      const seats: any[] = (() => {
        if (!event.seats) return [];
        if (Array.isArray(event.seats)) return event.seats;
        try {
          return JSON.parse(event.seats as any);
        } catch (err) {
          console.error("Invalid seats format", err);
          return [];
        }
      })();

    const artists = await prisma.artist.findMany({
      where: { id: { in: artistIds } }
    });

    const ticketTypeIds = ticketDetails.map(t => t.ticketTypeId);
    const ticketTypes = await prisma.ticketType.findMany({
      where: { id: { in: ticketTypeIds } }
    });

    const enrichedTickets = ticketDetails.map(ticket => {
      const ticketType = ticketTypes.find(tt => tt.id === ticket.ticketTypeId);
      return {
        ...ticket,
        ticketTypeName: ticketType?.name || 'Unknown'
      };
    });

    const enrichedArtists = artistIds.map(id => {
      const artist = artists.find(a => a.id === id);
      return {
        artistId: id,
        artistName: artist?.name || 'Unknown'
      };
    });

     let all_seats_booked = 0;
      if (seats.length > 0 && seats.every(seat => seat.status === "booked")) {
        all_seats_booked = 1;
      }

      let all_ticket_without_seats_booked = 0;
      if (
        ticketDetails.length > 0 &&
        ticketDetails.every(ticket =>
          ticket.hasTicketCount === true &&
          ticket.bookedTicketCount >= ticket.ticketCount
        )
      ) {
        all_ticket_without_seats_booked = 1;
      }

    return {
      ...event,
      ticket_details: enrichedTickets,
      artist_details: enrichedArtists,
      all_seats_booked,
      all_ticket_without_seats_booked
    };
  }));

  return res.json({
    events:enhancedEvents
  });
};
export const getEventDetails = async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;

    const event = await prisma.event.findFirst({
      where: { slug },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // --- Debugging: Check raw data types and values ---
    console.log('Raw event.artist_details:', event.artist_details, typeof event.artist_details);
    console.log('Raw event.ticket_details:', event.ticket_details, typeof event.ticket_details);
    // --- End Debugging ---


    const artistIds: number[] = Array.isArray(event.artist_details)
      ? event.artist_details.map(Number)
      : [];

    const artists = await prisma.artist.findMany({
      where: { id: { in: artistIds } },
    });

    const enrichedArtists = artistIds.map(id => {
      const artist = artists.find(a => a.id === id);
      return {
        artistId: id,
        artistName: artist?.name || 'Unknown',
      };
    });

    let ticketDetails: any[] = [];
    const rawTicketDetails = event.ticket_details; // Store the raw value

    // Robustly handle ticket_details, assuming it might be a JSON string or an array
    if (typeof rawTicketDetails === 'string') {
      try {
        const parsed = JSON.parse(rawTicketDetails);
        if (Array.isArray(parsed)) {
          ticketDetails = parsed;
        } else {
          console.warn('ticket_details is a string but not a JSON array:', rawTicketDetails);
        }
      } catch (e) {
        console.error('Error parsing event.ticket_details as JSON string:', e);
        // If it fails to parse, assume it's not a valid JSON array string
      }
    } else if (Array.isArray(rawTicketDetails)) {
      ticketDetails = rawTicketDetails;
    } else if (rawTicketDetails !== null && rawTicketDetails !== undefined) {
        console.warn('event.ticket_details is neither an array nor a string:', rawTicketDetails);
    }
    // If it's null/undefined or an invalid format, ticketDetails remains []

    let seats: any[] = [];
    const rawSeats = event.seats;

    if (typeof rawSeats === 'string') {
      try {
        const parsed = JSON.parse(rawSeats);
        if (Array.isArray(parsed)) {
          seats = parsed;
        } else {
          console.warn('seats is a string but not a JSON array:', rawSeats);
        }
      } catch (e) {
        console.error('Error parsing event.seats as JSON string:', e);
      }
    } else if (Array.isArray(rawSeats)) {
      seats = rawSeats;
    } else if (rawSeats !== null && rawSeats !== undefined) {
      console.warn('event.seats is neither an array nor a string:', rawSeats);
    }

    const ticketTypeIds = ticketDetails.map(t => t.ticketTypeId).filter(id => id !== undefined); // Ensure valid IDs

    const ticketTypes = await prisma.ticketType.findMany({
      where: { id: { in: ticketTypeIds } },
    });

    const enrichedTickets = ticketDetails.map(ticket => {
      const ticketType = ticketTypes.find(tt => tt.id === ticket.ticketTypeId);
      return {
        ...ticket,
        ticketTypeName: ticketType?.name || 'Unknown',
      };
    });

    let all_seats_booked = 0;
    if (seats.length > 0 && seats.every(seat => seat.status === "booked")) {
      all_seats_booked = 1;
    }

    // ✅ Check all tickets without seats booked
    let all_ticket_without_seats_booked = 0;
    if (
      ticketDetails.length > 0 &&
      ticketDetails.every(ticket =>
        ticket.hasTicketCount === true &&
        ticket.bookedTicketCount >= ticket.ticketCount
      )
    ) {
      all_ticket_without_seats_booked = 1;
    }

    const enrichedEvent = {
      ...event,
      artist_details: enrichedArtists,
      ticket_details: enrichedTickets,
      all_seats_booked,
      all_ticket_without_seats_booked
    };

    return res.json(enrichedEvent);
  } catch (error) {
    console.error('Error fetching event details:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await prisma.$disconnect();
  }
};

export const getEventSeats = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const event = await prisma.event.findFirst({
      where: { id },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

  
    return res.json(event.seats);
  } catch (error) {
    console.error('Error fetching event details:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


export const getLocations = async (req: Request, res: Response) => {
  try {
  
    const locations = [
      "BMICH",
      "Nelum Pokuna",
      "Musaeus College",
      "Bishop Collage"
    ];
    return res.json(locations);
  } catch (error) {
    console.error('Error fetching event details:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const getArtists = async (req: Request, res: Response) => {
  try {
  
    const artists = await prisma.artist.findMany({
      where: { status : 'active' },
    });

    return res.json(artists);
  } catch (error) {
    console.error('Error fetching event details:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};