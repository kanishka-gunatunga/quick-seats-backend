import { Request, Response, NextFunction } from 'express';

export function isStaffLoggedIn(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.staff) {
    return next();
  } else {
    return res.redirect('/staff');
  }
}
