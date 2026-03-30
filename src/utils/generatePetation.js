module.exports = function generatePetition() {
  const randomFiveDigits = Math.floor(1000000 + Math.random() * 9000000); 
  return "PTN" + randomFiveDigits;
};


