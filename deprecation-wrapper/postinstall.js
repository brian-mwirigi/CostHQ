#!/usr/bin/env node

const reset = "\x1b[0m";
const fgRed = "\x1b[31m";
const fgYellow = "\x1b[33m";
const fgCyan = "\x1b[36m";
const bgRed = "\x1b[41m";
const fgWhite = "\x1b[37m";

console.log("");
console.log(bgRed + fgWhite + " ⚠️  IMPORTANT UPDATE " + reset);
console.log("");
console.log(fgYellow + "The codesession-cli package has been officially rebranded to CostHQ!" + reset);
console.log("To receive future updates, new features, and security patches,");
console.log("please update your installation to the new package name:");
console.log("");
console.log(fgCyan + "    npm install -g costhq" + reset);
console.log("");
console.log(fgRed + "This codesession-cli package is now deprecated and will no longer be updated." + reset);
console.log("");
