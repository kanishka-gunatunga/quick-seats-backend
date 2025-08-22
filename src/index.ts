import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { Pool } from 'pg';
import apiRoutes from './routes/api/api.routes';
import adminRoutes from './routes/admin/admin.routes';
import staffRoutes from './routes/staff/staff.routes';
import path from 'path';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const PgSession = pgSession(session);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

dotenv.config();
const app = express();
app.set('trust proxy', 1);
app.use(cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  store: new PgSession({
    pool: pool,                
    tableName: 'user_sessions' 
  }),
  secret: 'quickseats20250516',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  res.locals.admin = req.session.admin;
  res.locals.staff = req.session.staff;
  next();
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/api', apiRoutes);
app.use('/', adminRoutes);
app.use('/staff', staffRoutes);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.url === '/cron/reset-seats') {
    await resetSeats();
    return res.status(200).json({ success: true });
  }
  return res.status(404).send('Not found');
}

async function resetSeats() {
  // Calculate the timestamp for 15 minutes ago
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  // Find all seat reservations that are older than 15 minutes
  const expiredReservations = await prisma.seatReservation.findMany({
    where: {
      createdAt: { lt: fifteenMinutesAgo },
    },
  });

  console.log('expiredReservations', expiredReservations);

  for (const reservation of expiredReservations) {
    console.log(
      `Processing expired reservation for seat: ${reservation.seat_id} in event: ${reservation.event_id}`
    );

    // Step 1: Find the event and seat data
    const event = await prisma.event.findUnique({
      where: { id: parseInt(reservation.event_id) },
      select: { seats: true, id: true },
    });

    if (!event || event.seats === null) {
      console.warn(`Event or seat data not found for event ID: ${reservation.event_id}. Skipping.`);
      await prisma.seatReservation.delete({ where: { id: reservation.id } });
      continue;
    }

    let seats: Array<{ seatId: string; status: string; [key: string]: any }>;

    if (typeof event.seats === 'string') {
      try {
        seats = JSON.parse(event.seats) as Array<{ seatId: string; status: string; [key: string]: any }>;
      } catch (parseError) {
        console.error("Failed to parse event.seats as JSON. Skipping.", parseError);
        await prisma.seatReservation.delete({ where: { id: reservation.id } });
        continue;
      }
    } else if (Array.isArray(event.seats)) {
      seats = event.seats as Array<{ seatId: string; status: string; [key: string]: any }>;
    } else {
      console.error("Invalid format for seat data in database. Skipping.", event.seats);
      await prisma.seatReservation.delete({ where: { id: reservation.id } });
      continue;
    }

    // Step 2: Update the seat status to 'available'
    const seatIndex = seats.findIndex((seat) => seat.seatId === reservation.seat_id);

    if (seatIndex !== -1) {
      if (seats[seatIndex].status === 'pending') {
        seats[seatIndex].status = 'available';

        await prisma.event.update({
          where: { id: event.id },
          data: {
            seats: typeof event.seats === 'string' ? JSON.stringify(seats) : seats,
          },
        });

        console.log(`Seat ${reservation.seat_id} in event ${event.id} marked as 'available'.`);
      } else {
        console.warn(`Seat ${reservation.seat_id} is not in 'pending' status. Skipping update.`);
      }
    } else {
      console.warn(`Seat ${reservation.seat_id} not found in event ${event.id}. Skipping.`);
    }

    // Step 3: Delete the expired reservation record
    await prisma.seatReservation.delete({
      where: { id: reservation.id },
    });

    console.log(`Expired reservation record ${reservation.id} deleted.`);
  }
}
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
