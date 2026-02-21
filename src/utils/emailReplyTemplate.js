function emailReplyTemplate(ticketId, message, agentName = "Support Agent") {
  return `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #fdfdfd; color: #333; border: 1px solid #e0e0e0; border-radius: 8px;">
      <div style="text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="color: #28a745; margin: 0;">Update on Your Support Ticket</h2>
      </div>

      <p>Hi,</p>

      <p>We have an update on your support ticket:</p>

      <table style="width: 100%; margin: 20px 0; background-color: #fff; border: 1px solid #ccc; border-radius: 4px;">
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Ticket ID:</strong></td>
          <td style="padding: 10px; border-bottom: 1px solid #eee; color: #28a745;"><strong>${ticketId}</strong></td>
        </tr>
        <tr>
          <td style="padding: 10px; vertical-align: top;"><strong>Reply from ${agentName}:</strong></td>
          <td style="padding: 10px;">${message}</td>
        </tr>
      </table>

      <p>If you need further assistance, you can reply to this email or view your ticket in your account.</p>

      <p style="margin-top: 30px;">Best regards,<br><strong>${agentName}</strong><br>Customer Support</p>

      <div style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
        <p>This is an automated email. Please do not reply directly to this message.</p>
      </div>
    </div>
  `;
}

module.exports = emailReplyTemplate;
