import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const healthCheck = async (req: Request, res: Response): Promise<void> => {
    try {
        // Check database connection
        await prisma.$queryRaw`SELECT 1`;

        res.status(200).json({
            status: "ok",
            db: "connected",
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("Health check DB error:", error);

        res.status(500).json({
            status: "error",
            db: "disconnected",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    }
};