// Checks the mail server login from this PC. Asks for the password without showing it; nothing is saved.
// Usage: node scripts/smtp-check.mjs
import nodemailer from "nodemailer";
import readline from "node:readline";

const HOST = "mail.all-niche.com", USER = "support@pandoraeg.com";

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

const pass = await askHidden(`Password for ${USER}: `);
console.log(`Length typed: ${pass.length} characters${pass !== pass.trim() ? " (has spaces at the start or end!)" : ""}`);
for (const port of [465, 587]) {
  const t = nodemailer.createTransport({ host: HOST, port, secure: port === 465, auth: { user: USER, pass } });
  try { await t.verify(); console.log(`port ${port}: LOGIN OK`); }
  catch (e) { console.log(`port ${port}: FAILED - ${String(e.message).slice(0, 120)}`); }
}
