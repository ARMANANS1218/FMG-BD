const express = require('express');
const router = express.Router();
const { createCustomerTicket, agentReply, forwardTicket, getAllTickets, getTicketById, assignAgentToTicket, takeTicket, updateTicketStatus, getAllTicketFilter, getAllTicketsByAssign, getRepliesByUser } = require('../controllers/new.ticket.controller');
const { validateToken, isAgent, isAdmin, isQA } = require('../utils/validateToken');

// 📩 Create ticket by customer (no token required)
router.post('/create-ticket', createCustomerTicket);

// 🗨️ Agent reply to a ticket (auth required)
router.post('/reply/:ticketId', validateToken,isAgent, agentReply);

// 🔁 Forward ticket to another agent (auth required)
router.post('/:ticketId/forward', validateToken,isAgent, forwardTicket);

// Assign or unassign agent (QA/TL only)
router.put('/assign/:ticketId', validateToken, isQA, assignAgentToTicket);

// Agent takes ticket (assigns to themselves)
router.put('/take/:ticketId', validateToken, isAgent, takeTicket);

// Update status (Agent)
router.put('/status/:ticketId', validateToken, updateTicketStatus);

// filter
router.get('/filter',validateToken,isAgent, getAllTicketFilter);

// 📋 Get all tickets (for admin/agents,qa)
router.get('/',validateToken, getAllTickets);

// find ticket by userId
router.get('/assign',validateToken,isAgent, getAllTicketsByAssign);
// all customer create
router.get('/replies/me', validateToken, getRepliesByUser);

// 🔍 Get single ticket by ID
router.get('/:ticketId',validateToken, isAgent, getTicketById);

module.exports = router;
