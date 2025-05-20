import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();

export const getAllEvents = async (req: Request, res: Response) => {
  const events = await prisma.event.findMany({ where: { status:'active' }});

  return res.json({
    events
  });
};

export const getTrendingEvents = async (req: Request, res: Response) => {
  const events = await prisma.event.findMany({ where: { status:'active' },take: 8});

  return res.json({
    events
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

  return res.json({ events });
};