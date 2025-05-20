import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();

export const getAllEvents = async (req: Request, res: Response) => {
  const events = await prisma.event.findMany({
    where: { status: 'active' }
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
    events: enhancedEvents
  });
};

export const getTrendingEvents = async (req: Request, res: Response) => {
  const events = await prisma.event.findMany({ where: { status:'active' },take: 8});

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