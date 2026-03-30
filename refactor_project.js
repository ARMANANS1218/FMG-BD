
const fs = require("fs");
const path = require("path");

const directories = [
  path.join(__dirname, "src/controllers"),
  path.join(__dirname, "src/middleware"),
  path.join(__dirname, "src/utils"),
  path.join(__dirname, "src/socket"),
  path.join(__dirname, "src/sockets"),
  path.join(__dirname, "src/email-ticketing")
];

function processDirectory(dir) {
  if(!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDirectory(fullPath);
    } else if (file.endsWith(".js") && file !== "customer.controller.js") {
      let content = fs.readFileSync(fullPath, "utf-8");
      let originalContent = content;
      
      // We will replace User with Staff for majority of employee-facing stuff
      content = content.replace(/require\((.*?)\/models\/User\x27\)/g, "require($1/models/Staff\x27)");
      content = content.replace(/require\((.*?)\/models\/User"\)/g, "require($1/models/Staff\")");
      
      // Replaces for "const User ="
      content = content.replace(/const User = /g, "const Staff = ");
      
      // Replaces for "User."
      content = content.replace(/User\.find/g, "Staff.find");
      content = content.replace(/User\.create/g, "Staff.create");
      content = content.replace(/User\.update/g, "Staff.update");
      content = content.replace(/User\.delete/g, "Staff.delete");
      content = content.replace(/User\.aggregate/g, "Staff.aggregate");
      content = content.replace(/User\.count/g, "Staff.count");
      
      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content, "utf-8");
        console.log("Updated: " + fullPath);
      }
    }
  }
}

directories.forEach(processDirectory);
console.log("Migration complete!");

