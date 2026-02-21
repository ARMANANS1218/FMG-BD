function emailTemplate(ticketId, subject, message) {
  return `
  <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f9f9f9; color: #333; border: 1px solid #e0e0e0; border-radius: 8px;">
    <div style="text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 16px; margin-bottom: 20px;">
      <h2 style="color: #007bff; margin: 0;">Support Ticket Created</h2>
    </div>

    <p>Hi,</p>

    <p>Thank you for contacting our support team. Your request has been received and a support ticket has been generated.</p>

    <table style="width: 100%; margin: 20px 0; background-color: #fff; border: 1px solid #ccc; border-radius: 4px;">
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Ticket ID:</strong></td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; color: #007bff;"><strong>${ticketId}</strong></td>
      </tr>
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Subject:</strong></td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${subject}</td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>Message:</strong></td>
        <td style="padding: 10px;">${message}</td>
      </tr>
    </table>

    <p>Our support team will get back to you as soon as possible. You can reply to this email if you have more information to share.</p>

    <p style="margin-top: 30px;">Best regards,<br><strong>Your Company Support Team</strong></p>

    <div style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
      <p>This is an automated message. Please do not reply directly to this email.</p>
    </div>
  </div>
  `;
}
module.exports = emailTemplate;