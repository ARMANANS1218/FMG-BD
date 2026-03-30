const express = require('express');
const {  sendMessage, getChatConversation,  transferPetition, getPetitionDetails, addReplyToPetition, getAllMessages } = require('../controllers/chatmessage.controller');
const { validateToken, isQA, isQAandAgent } = require('../utils/validateToken');

const router = express.Router();

router.post('/send',validateToken, sendMessage);
router.get('/petition/:petitionId', validateToken, getPetitionDetails);
router.post('/:petitionId/transfer-petition', validateToken,transferPetition);
router.post('/:petitionId/reply', validateToken, addReplyToPetition);
router.get('/conversation/:id',validateToken, getChatConversation);
router.get('/', getAllMessages);
module.exports = router;
