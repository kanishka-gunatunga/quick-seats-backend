import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: 'mail.genaitech.dev',
    port: 465,
    secure: true,
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
    },
});

export default transporter;
