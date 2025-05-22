import express from 'express';
import upload from '../../middlewares/upload';
import { isAdminLoggedIn } from '../../middlewares/authAdmin';
import { loginGet, loginPost, dashboard,logout } from '../../controllers/admin/userController';

 


const router = express.Router();

//Auth
router.get('/', loginGet);
router.post('/login', loginPost);
router.get('/logout', logout);
router.get('/dashboard', isAdminLoggedIn, dashboard);

export default router;
