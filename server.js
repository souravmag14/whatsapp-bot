import express from "express";
import axios from "axios";
import https from "https";
import moment from "moment";

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PORT, OPENAI_API_KEY } = process.env;

let receivedData = {
  message: "",
  senderName: "",
  senderPhoneNumber: ""
};

let initialMessageSent = false;
let awaitingIssueId = false;
let awaitingUserQuestion = false;
let booksCheckedOut = [];

// ------------------------
// Send initial menu message
// ------------------------
async function sendInitialMessage(req) {
  try {
    const message = req.body.entry[0].changes[0].value.messages[0];
    const senderName = req.body.entry[0].changes[0].value.contacts[0].profile.name;
    const businessPhoneNumberId = req.body.entry[0].changes[0].value.metadata.phone_number_id;

    await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: message.from,
      text: {
        body: `*📚 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\nIt is an auto-generated Message!\n\n🌏 Please explore our website: https://library.ysmranchi.net\n🔍 For OPAC search: https://ysmranchi-opac.kohacloud.in\n\n*Press 📝 1: Renew your Book*\n*Press 📝 2: Library Repository*\n*Press 📝 3: Newspaper Archive*\n*Press 📝 4: Subject Catalogue*\n*Press 📝 5: Update Mobile Number*\n*Press 📝 6: Pragya: Your Knowledge Assistant*`
      },
      context: { message_id: message.id }
    });

    initialMessageSent = true;
  } catch (error) {
    console.error("Error sending initial message:", error);
  }
}

// ------------------------
// Fetch checkout history
// ------------------------
async function fetchCheckOutHistoryReport() {
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.get('https://ysmranchi-opac.kohacloud.in/cgi-bin/koha/svc/report?id=94', { httpsAgent: agent });

    if (response.status !== 200) throw new Error(response.statusText);
    return response.data;
  } catch (error) {
    throw new Error(error.message);
  }
}

// ------------------------
// Handle renew book (option 1)
// ------------------------
async function handleReplyOne(req) {
  try {
    const message = req.body.entry[0].changes[0].value.messages[0];
    const senderPhoneNumber = req.body.entry[0].changes[0].value.contacts[0].wa_id;
    const senderName = req.body.entry[0].changes[0].value.contacts[0].profile.name;
    const businessPhoneNumberId = req.body.entry[0].changes[0].value.metadata.phone_number_id;

    if (!awaitingIssueId) {
      const reportResults = await fetchCheckOutHistoryReport();
      const phoneNumber = senderPhoneNumber.replace(/^91/, '');
      booksCheckedOut = reportResults.filter(record => record[3] === phoneNumber);

      if (booksCheckedOut.length === 0) {
        await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to: message.from,
          text: {
            body: `*📖 No check-out history found in your Name*\n\nPlease visit Central Library, YSM with ID card to Issue Book or update your WhatsApp number:\nhttps://library.ysmranchi.net/update`
          },
          context: { message_id: message.id }
        });
        return;
      }

      // Build message for list of checked out books
      let messageBody = `Dear ${senderName},\n\n📔 The following books are checked out in your name:\n`;
      booksCheckedOut.forEach((record, index) => {
        const dueDate = record[0] || 'Unknown';
        const authorName = record[6] || 'Unknown';
        const bookTitle = record[5] || 'Unknown';
        const barcode = record[8] || 'Unknown';
        const issueId = record[10] || 'Unknown';
        const dueDays = moment(dueDate, "YYYY-MM-DD").diff(moment(), 'days');

        messageBody += `\n\📖 *${index + 1}. Book Title:* ${bookTitle}\n   *Author:* ${authorName}\n   *Due Date:* ${dueDate}\n   *Days to Overdue:* ${dueDays} Days\n   *Barcode:* ${barcode}\n   *Issue ID:* ${issueId}\n`;
      });
      messageBody += `\n🚨 Reply with *exit* to return to the main menu`;

      await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        to: message.from,
        text: { body: messageBody },
        context: { message_id: message.id }
      });

      awaitingIssueId = true;

    } else {
      // User replies with serial number
      const userReply = message.text.body.trim();
      if (userReply.toLowerCase() === 'exit') {
        awaitingIssueId = false;
        await sendInitialMessage(req);
        return;
      }

      const index = parseInt(userReply) - 1;
      if (index < 0 || index >= booksCheckedOut.length) {
        await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to: message.from,
          text: { body: `❌ Invalid serial number. Please reply with a valid number or type *exit*.` },
          context: { message_id: message.id }
        });
        return;
      }

      const selectedBook = booksCheckedOut[index];
      const issueId = selectedBook[10] || 'Unknown';
      const bookTitle = selectedBook[5] || 'Unknown';
      const barcode = selectedBook[8] || 'Unknown';

      const domain = 'https://ysmranchi-staff.kohacloud.in';
      const username = 'souravnag';
      const password = '@Yss132989';
      const url = `${domain}/api/v1/checkouts/${issueId}/renewals`;

      try {
        const response = await axios.post(url, {}, {
          headers: { 'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') },
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });

        const newDueDate = response.data.due_date;
        await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to: message.from,
          text: {
            body: `Success! 🎉\n📚 The book "${bookTitle}" (Barcode: ${barcode}) has been renewed.\nNew due date: *${newDueDate}*\n\nType *exit* to return to main menu.`
          },
          context: { message_id: message.id }
        });

      } catch (error) {
        await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to: message.from,
          text: { body: `❌ Error: Maximum renewal reached. Please return the book.\nType *exit* to return to main menu.` },
          context: { message_id: message.id }
        });
      }

      awaitingIssueId = false;
    }

  } catch (error) {
    console.error("Error in handleReplyOne:", error);
  }
}

// ------------------------
// Handle static options 2-6
// ------------------------
async function handleStaticMessage(req, option) {
  try {
    const message = req.body.entry[0].changes[0].value.messages[0];
    const senderName = req.body.entry[0].changes[0].value.contacts[0].profile.name;
    const businessPhoneNumberId = req.body.entry[0].changes[0].value.metadata.phone_number_id;

    let responseMessage;
    switch(option) {
      case "2": responseMessage = `🌏 Explore Repository: https://library.ysmranchi.net/dspace`; break;
      case "3": responseMessage = `🌏 Newspaper Archive: https://ysmcentallibrary.infinityfreeapp.com/result.php`; break;
      case "4": responseMessage = `🌏 Subject Catalogue: https://library.ysmranchi.net/catalouge/book.php`; break;
      case "5": responseMessage = `🌏 Update Mobile Number: https://library.ysmranchi.net/update/index.php`; break;
      case "6":
        responseMessage = `📝 Learning Mode Activated! Ask your questions below. Type *exit* to return to menu.`;
        awaitingUserQuestion = true;
        break;
      default: responseMessage = "Invalid option."; break;
    }

    await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: message.from,
      text: { body: responseMessage },
      context: { message_id: message.id }
    });

  } catch (error) {
    console.error("Error in handleStaticMessage:", error);
  }
}

// ------------------------
// ChatGPT response
// ------------------------
async function getChatGPTResponse(userMessage) {
  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userMessage }]
    }, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" }
    });

    let chatGPTResponse = response.data.choices[0].message.content;
    chatGPTResponse = `💬 ${chatGPTResponse}\n\n🚪 Type *exit* to close the chat session.\n*Designed by Central Library*`;
    return chatGPTResponse;
  } catch (error) {
    console.error("Error getting ChatGPT response:", error);
    return "Sorry, I couldn't process your request at the moment.";
  }
}

// ------------------------
// Webhook POST (WhatsApp)
// ------------------------
app.post("/webhook", async (req, res) => {
  const change = req.body.entry?.[0]?.changes[0]?.value;
  const message = change?.messages?.[0];

  if (message?.type === "text") {
    receivedData.message = message.text.body;
    receivedData.senderPhoneNumber = change?.contacts?.[0]?.wa_id;
    receivedData.senderName = change?.contacts?.[0]?.profile?.name;
    const businessPhoneNumberId = change?.metadata?.phone_number_id;

    try {
      if (!initialMessageSent) await sendInitialMessage(req);
      else if (awaitingIssueId) await handleReplyOne(req);
      else if (awaitingUserQuestion) {
        const userQuestion = message.text.body.trim();
        if (userQuestion.toLowerCase() === 'exit') {
          awaitingUserQuestion = false;
          await sendInitialMessage(req);
        } else {
          const chatGPTResponse = await getChatGPTResponse(userQuestion);
          await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            to: message.from,
            text: { body: chatGPTResponse },
            context: { message_id: message.id }
          }, { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } });
        }
      } else {
        const selectedOption = message.text.body.trim().toLowerCase();
        if (selectedOption === "1") await handleReplyOne(req);
        else if (["2","3","4","5","6"].includes(selectedOption)) await handleStaticMessage(req, selectedOption);
        else if (!isNaN(selectedOption)) await handleReplyOne(req);
        else await sendInitialMessage(req);
      }

      // Mark message as read
      await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: message.id
      }, { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } });

    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  // Log statuses
  const statuses = change?.statuses;
  if (statuses?.length) {
    statuses.forEach(status => console.log(`📦 Message Status -> ID: ${status.id}, To: ${status.recipient_id}, Status: ${status.status}, Timestamp: ${status.timestamp}`));
  }

  res.sendStatus(200);
});

// ------------------------
// Webhook GET (Verification)
// ------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified successfully!");
    res.status(200).send(challenge);
  } else res.sendStatus(403);
});

// ------------------------
// Root endpoint for debugging
// ------------------------
app.get("/", (req, res) => {
  res.send(`<pre>Received Data:\n${JSON.stringify(receivedData, null, 2)}</pre>`);
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
