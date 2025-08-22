import express from 'express';
import {restSeats} from '../../controllers/cron/cronController';

const router = express.Router();

router.get('/reset-seats', restSeats);


export default router;
 