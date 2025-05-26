import express from 'express';
import { login, register, updateProfileSettings, updateSecuritySettings,bookingHistory,paymentHistory,getUserDetails } from '../../controllers/api/userController';
import { getAllEvents,getTrendingEvents,getUpcomingEvents,getEventDetails } from '../../controllers/api/eventController';
import { checkout} from '../../controllers/api/checkoutController';
import { authenticate } from '../../middlewares/authMiddleware';
const router = express.Router();

//User
router.post('/register', register);
router.post('/login', login);
router.get('/get-user-details/:id',authenticate, getUserDetails);
router.post('/update-profile-settings/:id',authenticate, updateProfileSettings);
router.post('/update-security-settings/:id',authenticate, updateSecuritySettings);
router.get('/booking-history/:id',authenticate, bookingHistory);
router.get('/payment-history/:id',authenticate, paymentHistory);

//Events
router.get('/get-all-events', getAllEvents);
router.get('/get-trending-events', getTrendingEvents);
router.get('/get-upcoming-events', getUpcomingEvents);
router.get('/get-event-details/:slug', getEventDetails);


//Checkout
router.post('/checkout', checkout);


export default router;
 