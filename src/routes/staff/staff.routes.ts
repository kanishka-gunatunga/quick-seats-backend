import express from 'express';
import upload from '../../middlewares/upload';
import { isStaffLoggedIn } from '../../middlewares/authStaff';
import { loginGet, loginPost, dashboard,logout } from '../../controllers/staff/userController';

 


const router = express.Router();

//Auth
router.get('/', loginGet);
router.post('/login', loginPost);
router.get('/logout', logout);
router.get('/dashboard', isStaffLoggedIn, dashboard);

export default router;
