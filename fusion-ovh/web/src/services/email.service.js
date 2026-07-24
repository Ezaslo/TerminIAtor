
const nodemailer = require('nodemailer');

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (
    !host ||
    !port ||
    !user ||
    !password
  ) {
    throw new Error(
      'La configuration SMTP est incomplète.'
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass: password,
    },
  });
}

async function sendPasswordEmail({
  to,
  password,
}) {
  const transporter =
    createTransporter();

  const from =
    process.env.SMTP_FROM ||
    process.env.SMTP_USER;

  return transporter.sendMail({
    from,
    to,
    subject:
      'Votre mot de passe TerminIAtor',
    text:
      `Votre nouveau mot de passe est : ${password}`,
  });
}

module.exports = {
  sendPasswordEmail,
};
