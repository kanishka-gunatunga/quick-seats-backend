import express from 'express';
import { login, register, updateProfileSettings } from '../../controllers/api/userController';
import { getAllEvents,getTrendingEvents,getUpcomingEvents,getEventDetails } from '../../controllers/api/eventController';
import { checkout} from '../../controllers/api/checkoutController';
const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/update-profile-settings/:id', updateProfileSettings);

//Events
router.get('/get-all-events', getAllEvents);
router.get('/get-trending-events', getTrendingEvents);
router.get('/get-upcoming-events', getUpcomingEvents);
router.get('/get-event-details/:slug', getEventDetails);


//Checkout
router.post('/checkout', checkout);


export default router;
 