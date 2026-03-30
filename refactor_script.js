
const fs = require("fs");
const path = require("path");

const userPath = path.join(__dirname, "src/models/User.js");
const staffPath = path.join(__dirname, "src/models/Staff.js");

let userCode = fs.readFileSync(userPath, "utf-8");

let staffCode = userCode.replace(/UserSchema/g, "StaffSchema");
staffCode = staffCode.replace(/module\.exports = mongoose\.model\(\x27User\x27, StaffSchema\);/g, "module.exports = mongoose.model(\x27Staff\x27, StaffSchema);");
staffCode = staffCode.replace(/\[\x27SuperAdmin\x27, \x27Admin\x27, \x27Agent\x27, \x27QA\x27, \x27TL\x27, \x27Management\x27, \x27Dev\x27, \x27Customer\x27\]/g, "[\x27SuperAdmin\x27, \x27Admin\x27, \x27Agent\x27, \x27QA\x27, \x27TL\x27, \x27Management\x27, \x27Dev\x27, \x27Center\x27]");
fs.writeFileSync(staffPath, staffCode);

// Optional: you can strip staff roles from User.js
userCode = userCode.replace(/\[\x27SuperAdmin\x27, \x27Admin\x27, \x27Agent\x27, \x27QA\x27, \x27TL\x27, \x27Management\x27, \x27Dev\x27, \x27Customer\x27\]/g, "[\x27Customer\x27]");
fs.writeFileSync(userPath, userCode);

console.log("Created Staff.js and modified User.js base role");

