// const { Resend } = require('resend');

// const resend = new Resend(process.env.RESEND_API_KEY);

// const sendEmail = async (to, subject, text, pdfBuffer, fileName) => {
//   console.log('--- pdf buffer ---',pdfBuffer)
//   try {

//     await resend.emails.send({
//     from: 'RADNUS <noreply@service.radnus.in>',
//       to: [to],
//       subject: subject,
//       text: text,
//       attachments: [
//         {
//           filename: fileName || "file.pdf",
//           content: pdfBuffer,
//         },
//       ],
//     });

//     console.log("Email sent successfully ✅");

//   } catch (error) {
//     console.error("EMAIL ERROR:", error);
//     throw error;
//   }
// };

// module.exports = sendEmail;

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (to, subject, text, pdfBuffer, fileName) => {

  try {

    await resend.emails.send({
      from: "RADNUS <noreply@service.radnus.in>",
      to: [to],
      subject: subject,
      text: text,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer
        }
      ]
    });

    console.log("Email sent successfully");

  } catch (error) {

    console.error("EMAIL ERROR:", error);
    throw error;

  }

};

module.exports = sendEmail;