import { Request, Response, NextFunction } from 'express';

export function isAdminLoggedIn(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.admin) {
    return next();
  } else {
    return res.redirect('/');
  }
}
