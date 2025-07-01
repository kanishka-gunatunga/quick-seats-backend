import express from 'express';
import { login, register, updateProfileSettings, updateSecuritySettings,bookingHistory,paymentHistory,getUserDetails,forgotPassword,
validateOtp, resetPassword,resendOtp } from '../../controllers/api/userController';
import { getAllEvents,getTrendingEvents,getUpcomingEvents,getEventDetails,getEventSeats,getLocations,getArtists } from '../../controllers/api/eventController';
import { checkout,cybersourceCallback} from '../../controllers/api/checkoutController';
import { selectSeat,resetSeats,unselectSeat} from '../../controllers/api/seatController';
import { authenticate } from '../../middlewares/authMiddleware';
const router = express.Router();

//User
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/validate-otp', validateOtp);
router.post('/reset-password', resetPassword);
router.get('/get-user-details/:id',authenticate, getUserDetails);
router.post('/update-profile-settings/:id',authenticate, updateProfileSettings);
router.post('/update-security-settings/:id',authenticate, updateSecuritySettings);
router.get('/booking-history/:id',authenticate, bookingHistory);
router.get('/payment-history/:id',authenticate, paymentHistory);
router.post('/resend-otp', resendOtp);

//Events
router.get('/get-all-events', getAllEvents);
router.get('/get-trending-events', getTrendingEvents);
router.get('/get-upcoming-events', getUpcomingEvents);
router.get('/get-event-details/:slug', getEventDetails);
router.get('/get-locations', getLocations);
router.get('/get-artists', getArtists);

//Booking
router.post('/select-seat', selectSeat);
router.post('/reset-seats', resetSeats);
router.get('/get-event-seats/:id', getEventSeats);
router.post('/unselect-seat', unselectSeat);

//Checkout
router.post('/checkout', checkout);
router.post('/cybersource-callback', cybersourceCallback);

export default router;
 