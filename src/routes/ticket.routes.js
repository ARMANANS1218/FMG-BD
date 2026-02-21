const express = require("express");

const { validateToken, isAgent, isQA, isAgentOrTL } = require("../utils/validateToken");
const { createTicket, replyToTicket, getAgentTickets, forwardTicket, qaAssignTicket, getTicketReplies, getAllTicketsByAssign, getAllTicketFilter, getTicketByTicketId } = require("../controllers/ticket.controller");

const router = express.Router();

router.post("/", createTicket);
router.post("/:ticketId/reply", validateToken,isAgent, replyToTicket); 
router.get("/agent-tickets",validateToken,isAgentOrTL,  getAgentTickets);
router.post("/forward", validateToken, isAgent, forwardTicket);
router.post("/qa-assign", validateToken, isQA, qaAssignTicket);
router.get("/replies/:ticketId", validateToken, isAgent, getTicketReplies);
router.get('/assign-by',validateToken, getAllTicketsByAssign);
router.get('/filter',validateToken,getAllTicketFilter);
router.get("/:ticketId", validateToken,  getTicketByTicketId);
module.exports = router;
