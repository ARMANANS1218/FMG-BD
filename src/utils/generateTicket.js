module.exports = function generateTicketId() {
  const timestamp = Date.now().toString();
  return "TKT-" + timestamp.slice(-6);
};
