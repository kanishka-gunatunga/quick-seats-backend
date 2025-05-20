import express from 'express';
import { login, register } from '../../controllers/api/userController';
import { getAllEvents,getTrendingEvents,getUpcomingEvents,getEventDetails } from '../../controllers/api/eventController';
const router = express.Router();

router.post('/register', register);
router.post('/login', login);

//Events
router.get('/get-all-events', getAllEvents);
router.get('/get-trending-events', getTrendingEvents);
router.get('/get-upcoming-events', getUpcomingEvents);
router.get('/get-event-details/:slug', getEventDetails);
export default router;
 