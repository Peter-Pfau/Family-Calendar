const nodemailer = require('nodemailer');

let transporter = null;

function isEmailConfigured() {
    return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransporter() {
    if (!isEmailConfigured()) {
        return null;
    }

    if (!transporter) {
        const host = process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com';
        const port = Number(process.env.GMAIL_SMTP_PORT || 465);
        const secure = (process.env.GMAIL_SMTP_SECURE || 'true').toLowerCase() !== 'false';

        transporter = nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });
    }

    return transporter;
}

async function sendEmail({ to, subject, text, html }) {
    if (!to || !subject || !text) {
        return {
            sent: false,
            message: 'Missing required email fields (to, subject, text)'
        };
    }

    const mailer = getTransporter();
    if (!mailer) {
        return {
            sent: false,
            message: 'Gmail not configured (missing GMAIL_USER or GMAIL_APP_PASSWORD)'
        };
    }

    try {
        const fromEmail = process.env.GMAIL_USER;
        const fromName = process.env.EMAIL_FROM_NAME || 'Family Calendar';
        const info = await mailer.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            text,
            html: html || text.replace(/\n/g, '<br>')
        });

        return {
            sent: true,
            message: 'Email sent via Gmail SMTP',
            response: {
                messageId: info.messageId,
                accepted: info.accepted,
                rejected: info.rejected
            }
        };
    } catch (error) {
        console.error('[email] Gmail sendEmail failed:', error);
        return {
            sent: false,
            message: error?.message || 'Failed to send email via Gmail SMTP'
        };
    }
}

module.exports = {
    isEmailConfigured,
    sendEmail
};
