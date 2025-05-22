import express from 'express';
import upload from '../../middlewares/upload';
import { isAdminLoggedIn } from '../../middlewares/authAdmin';
import { loginGet, loginPost, dashboard,logout } from '../../controllers/admin/userController';
import { addAdminGet, addAdminPost, admins, activateAdmin, deactivateAdmin ,editAdminGet, editAdminPost } from '../../controllers/admin/adminController';
import { addArtistGet, addArtistPost, artists, activateArtist, deactivateArtist ,editArtistGet, editArtistPost} from '../../controllers/admin/artistController';
import { addTicketTypeGet, addTicketTypePost, ticketTypes, activateTicketType, deactivateTicketType ,editTicketTypeGet, editTicketTypePost} from '../../controllers/admin/ticketTypeController';
import { addEventGet, addEventPost, events, activateEvent, deactivateEvent ,editEventGet, editEventPost} from '../../controllers/admin/eventController';
 import { addStaffGet, addStaffPost, staffs, activateStaff, deactivateStaff ,editStaffGet, editStaffPost } from '../../controllers/admin/staffController';


const router = express.Router();

//Auth
router.get('/', loginGet);
router.post('/login', loginPost);
router.get('/logout', logout);
router.get('/dashboard', isAdminLoggedIn, dashboard);

//Admins Management
router.get('/add-admin', isAdminLoggedIn, addAdminGet);
router.post('/add-admin', isAdminLoggedIn, addAdminPost);
router.get('/admin/activate/:id', isAdminLoggedIn, activateAdmin);
router.get('/admin/deactivate/:id', isAdminLoggedIn, deactivateAdmin);
router.get('/admin/edit/:id', isAdminLoggedIn, editAdminGet);
router.post('/admin/edit/:id', isAdminLoggedIn, editAdminPost);
router.get('/admins', isAdminLoggedIn, admins);

//Staff Management
router.get('/add-staff', isAdminLoggedIn, addStaffGet);
router.post('/add-staff', isAdminLoggedIn, addStaffPost);
router.get('/staff/activate/:id', isAdminLoggedIn, activateStaff);
router.get('/staff/deactivate/:id', isAdminLoggedIn, deactivateStaff);
router.get('/staff/edit/:id', isAdminLoggedIn, editStaffGet);
router.post('/staff/edit/:id', isAdminLoggedIn, editStaffPost);
router.get('/staffs', isAdminLoggedIn, staffs);

//Artists Management
router.get('/add-artist', isAdminLoggedIn, addArtistGet);
router.post('/add-artist', isAdminLoggedIn, addArtistPost);
router.get('/artist/activate/:id', isAdminLoggedIn, activateArtist);
router.get('/artist/deactivate/:id', isAdminLoggedIn, deactivateArtist);
router.get('/artist/edit/:id', isAdminLoggedIn, editArtistGet);
router.post('/artist/edit/:id', isAdminLoggedIn, editArtistPost);
router.get('/artists', isAdminLoggedIn, artists);

//Ticket Type Management
router.get('/add-ticket-type', isAdminLoggedIn, addTicketTypeGet);
router.post('/add-ticket-type', isAdminLoggedIn, addTicketTypePost);
router.get('/ticket-type/activate/:id', isAdminLoggedIn, activateTicketType);
router.get('/ticket-type/deactivate/:id', isAdminLoggedIn, deactivateTicketType);
router.get('/ticket-type/edit/:id', isAdminLoggedIn, editTicketTypeGet);
router.post('/ticket-type/edit/:id', isAdminLoggedIn, editTicketTypePost);
router.get('/ticket-types', isAdminLoggedIn, ticketTypes);

//Event Management
router.get('/add-event', isAdminLoggedIn, addEventGet);
router.post('/add-event',upload.fields([{ name: 'banner_image', maxCount: 1 },{ name: 'featured_image', maxCount: 1 },]), isAdminLoggedIn, addEventPost);
router.get('/event/activate/:id', isAdminLoggedIn, activateEvent);
router.get('/event/deactivate/:id', isAdminLoggedIn, deactivateEvent);
router.get('/event/edit/:id', isAdminLoggedIn, editEventGet);
router.post('/event/edit/:id',upload.fields([{ name: 'banner_image', maxCount: 1 },{ name: 'featured_image', maxCount: 1 },]), isAdminLoggedIn, editEventPost);
router.get('/events', isAdminLoggedIn, events);

export default router;
