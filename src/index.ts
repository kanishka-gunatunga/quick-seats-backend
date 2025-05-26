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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
