import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { Pool } from 'pg';
import apiRoutes from './routes/api/api.routes';
import adminRoutes from './routes/admin/admin.routes';
import staffRoutes from './routes/staff/staff.routes';
import cronRoutes from './routes/cron/cron.routes';
import fs from 'fs';
import path from 'path';
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

// app.use('/api', apiRoutes);
// app.use('/', adminRoutes);
// app.use('/staff', staffRoutes);
// app.use('/cron', cronRoutes);

app.use((req, res) => {
  const filePath = path.join(__dirname, 'public', 'site_unavailable.html');

  // Read the HTML file and send it
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      res.status(500).send('Something went wrong.');
    } else {
      res.status(200).setHeader('Content-Type', 'text/html').send(data);
    }
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
