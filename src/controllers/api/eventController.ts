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
        ...(startDate && endDate && {
          start_date_time: {
            gte: new Date(String(startDate)),
            lte: new Date(String(endDate)),
          }
        })
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
        const tickets: any[] = Array.isArray(event.ticket_details) ? event.ticket_details : [];
        return tickets.some(ticket => ticket.price >= min && ticket.price <= max);
      });
    }

    // Step 4: Enrich each event with artists and ticket types
    const enhancedEvents = await Promise.all(events.map(async (event) => {
      const artistIds: number[] = Array.isArray(event.artist_details)
        ? event.artist_details.map(Number)
        : [];

      const ticketDetails: any[] = Array.isArray(event.ticket_details)
        ? event.ticket_details
        : [];

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

      return {
        ...event,
        ticket_details: enrichedTickets,
        artist_details: enrichedArtists
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
    where: { status: 'active' },
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

      const ticketDetails: any[] = Array.isArray(event.ticket_details)
        ? (event.ticket_details as any[])
        : [];

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

      return {
        ...eventWithoutOrderCount,
        ticket_details: enrichedTickets,
        artist_details: enrichedArtists,
        orderCount: orderCount, // Keep orderCount if you want to expose it
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

    const ticketDetails: any[] = Array.isArray(event.ticket_details)
      ? event.ticket_details
      : [];

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

    return {
      ...event,
      ticket_details: enrichedTickets,
      artist_details: enrichedArtists
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

    const ticketDetails: any[] = Array.isArray(event.ticket_details)
      ? event.ticket_details
      : [];

    const ticketTypeIds = ticketDetails.map(t => t.ticketTypeId);
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

    const enrichedEvent = {
      ...event,
      artist_details: enrichedArtists,
      ticket_details: enrichedTickets,
    };

    return res.json(enrichedEvent);
  } catch (error) {
    console.error('Error fetching event details:', error);
    return res.status(500).json({ error: 'Internal server error' });
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