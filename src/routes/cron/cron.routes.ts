import express from 'express';
import {restSeats,cleanupPendingSeats} from '../../controllers/cron/cronController';

const router = express.Router();

router.get('/reset-seats', restSeats);
router.get('/cleanup-pending-seats', cleanupPendingSeats);

export default router;
 