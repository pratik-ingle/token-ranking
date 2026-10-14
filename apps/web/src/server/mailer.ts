import { env } from "./env";
import { log } from "./logger";

/**
 * Sends account-recovery mail. The address is used only to deliver this
 * message (the user typed it moments ago); it is never stored or logged.
 */
export async function sendRecoveryEmail(to: string, link: string): Promise<void> {
  const text = `Someone (hopefully you) asked to recover a TokenRank account.\n\nOpen this link within 30 minutes to sign in, then add a new passkey or password:\n\n${link}\n\nIf you didn't ask for this, ignore this email.`;
  if (env.smtpUrl) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(env.smtpUrl);
    await transport.sendMail({ from: env.mailFrom, to, subject: "Your TokenRank recovery link", text });
    return;
  }
  if (!env.isProd) {
    // Development only: print the link (not the address) so recovery can be tested.
    console.log(`[dev mailer] recovery link: ${link}`);
    return;
  }
  log.warn("recovery_email_not_configured");
}
