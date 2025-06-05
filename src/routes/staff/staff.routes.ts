import express from 'express';
import upload from '../../middlewares/upload';
import { isStaffLoggedIn } from '../../middlewares/authStaff';
import { loginGet, loginPost, dashboard,logout } from '../../controllers/staff/userController';
import { issueTickets,ticketVerify,confirmTicketIssue,issueNoSeatTickets } from '../../controllers/staff/ticketController';
 


const router = express.Router();

//Auth
router.get('/', loginGet);
router.post('/login', loginPost);
router.get('/logout', logout);
router.get('/dashboard', isStaffLoggedIn, dashboard);
router.get('/issue-tickets', isStaffLoggedIn, issueTickets);
router.post('/ticket-verify', isStaffLoggedIn, ticketVerify);
router.post('/confirm-ticket-issue', isStaffLoggedIn, confirmTicketIssue);
router.post('/issue-no-seat-tickets', isStaffLoggedIn, issueNoSeatTickets);
export default router;
