// src/types/express-session.d.ts
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    admin?: {
      id: number;
      email: string;
      name: string?;
      phone: string?;
    };
    staff?: {
      id: number;
      email: string;
      name: string?;
      phone: string?;
    };
    success: string?;
    error: string?;
    formData?: Record<string, any>; 
    validationErrors?: Record<string, any>; 
  }
}