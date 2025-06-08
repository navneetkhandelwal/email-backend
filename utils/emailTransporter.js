const nodemailer = require('nodemailer');

function createTransporter(email, password) {
  console.log('Creating email transporter with:', {
    email,
    usingAppPassword: password.length === 16
  });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: password
      },
      debug: true,
      logger: true
    });

    transporter.verify(function(error, success) {
      if (error) {
        console.error('Transporter verification failed:', {
          error: error.message,
          code: error.code,
          response: error.response,
          stack: error.stack
        });
      } else {
        console.log('Server is ready to take our messages');
      }
    });

    return transporter;
  } catch (error) {
    console.error('Error creating transporter:', {
      error: error.message,
      code: error.code,
      response: error.response,
      stack: error.stack
    });
    throw error;
  }
}

module.exports = createTransporter; 