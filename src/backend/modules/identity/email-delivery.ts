export type EmailProviderType = 'none' | 'resend' | 'webhook';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailDeliveryConfig {
  provider: EmailProviderType;
  from: string;
  resendApiKey: string | null;
  webhookUrl: string | null;
  webhookBearer: string | null;
}

export class EmailDeliveryService {
  constructor(private readonly config: EmailDeliveryConfig) {}

  public isConfigured(): boolean {
    if (this.config.provider === 'resend') return Boolean(this.config.resendApiKey);
    if (this.config.provider === 'webhook') return Boolean(this.config.webhookUrl);
    return false;
  }

  public async sendVerificationEmail(params: { to: string; token: string }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Verify your LAVRAY Account email',
      text: `Your LAVRAY verification code is: ${params.token}\n\nThis code expires in 24 hours. If you did not create a LAVRAY account, you can ignore this email.`,
      html: `<p>Your LAVRAY verification code is:</p><p><strong>${escapeHtml(params.token)}</strong></p><p>This code expires in 24 hours.</p>`
    });
  }

  public async sendPasswordResetEmail(params: { to: string; token: string }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Reset your LAVRAY Account password',
      text: `Your LAVRAY password reset code is: ${params.token}\n\nThis code expires in 1 hour. If you did not request a password reset, you can ignore this email.`,
      html: `<p>Your LAVRAY password reset code is:</p><p><strong>${escapeHtml(params.token)}</strong></p><p>This code expires in 1 hour.</p>`
    });
  }

  public async send(msg: EmailMessage): Promise<void> {
    if (this.config.provider === 'none') {
      return;
    }

    if (this.config.provider === 'resend') {
      if (!this.config.resendApiKey) {
        throw new Error('RESEND_API_KEY is required when LAVRAY_EMAIL_PROVIDER=resend');
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.resendApiKey}`
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html
        })
      });
      if (!res.ok) {
        throw new Error(`Resend email delivery failed (HTTP ${res.status})`);
      }
      return;
    }

    if (this.config.provider === 'webhook') {
      if (!this.config.webhookUrl) {
        throw new Error('LAVRAY_EMAIL_WEBHOOK_URL is required when LAVRAY_EMAIL_PROVIDER=webhook');
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.webhookBearer) {
        headers.Authorization = `Bearer ${this.config.webhookBearer}`;
      }
      const res = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: this.config.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html
        })
      });
      if (!res.ok) {
        throw new Error(`Webhook email delivery failed (HTTP ${res.status})`);
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
