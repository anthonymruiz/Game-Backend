import { injectable } from 'tsyringe';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';

@injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: Number(process.env.SMTP_PORT) || 587,
      auth: {
        user: process.env.SMTP_USER || 'user',
        pass: process.env.SMTP_PASS || 'pass',
      },
    });
  }

  public async sendTemplatedEmail(to: string, templateName: string, lang: string, context: Record<string, string>): Promise<void> {
    try {
      // Fallback to 'en' if the requested language template doesn't exist
      let templatePath = path.resolve(process.cwd(), `src/langs/${lang}/${templateName}.json`);
      
      try {
        await fs.access(templatePath);
      } catch {
        templatePath = path.resolve(process.cwd(), `src/langs/en/${templateName}.json`);
      }

      const fileContent = await fs.readFile(templatePath, 'utf-8');
      const template = JSON.parse(fileContent);

      let subject = template.subject;
      let body = template.body;

      for (const [key, value] of Object.entries(context)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        subject = subject.replace(regex, value);
        body = body.replace(regex, value);
      }

      await this.transporter.sendMail({
        from: '"WallRush Team" <no-reply@wallrush.local>',
        to,
        subject,
        text: body,
      });

    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send email');
    }
  }
}
