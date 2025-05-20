import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session';
import apiRoutes from './routes/api/api.routes';
import adminRoutes from './routes/admin/admin.routes';
import path from 'path';

dotenv.config();
const app = express();

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'quickseats20250516',
  resave: false,
  saveUninitialized: true
}));

app.use((req, res, next) => {
  res.locals.admin = req.session.admin;
  next();
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use('/api', apiRoutes);
app.use('/', adminRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
