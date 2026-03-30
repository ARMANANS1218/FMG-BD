const express = require('express');
const { validateToken, isAgent } = require('../utils/validateToken');
const { startConversation, sendMessage, transferPetition, replyOnPetition,  getPetitionDetails, closeConversation, getAllCustomers, getAllConversations } = require('../controllers/new.chat.controller');

const router = express.Router();

router.post("/conversation/start", startConversation);
router.post('/send', sendMessage);
router.post('/transfer-petition', validateToken,transferPetition);
router.post('/petition/reply', validateToken, replyOnPetition);
router.get('/petition/:petitionId',  getPetitionDetails);
router.get('/conversation/:conversationId',validateToken,getAllConversations);
router.post('/close', closeConversation);
router.get('/all', getAllCustomers);

module.exports = router;
