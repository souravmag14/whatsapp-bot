import express from "express";
import axios from "axios";
import https from "https";
import moment from "moment";

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PORT, OPENAI_API_KEY } = process.env;

// Track per-user state
let userState = {}; // key = phoneNumber

const getUserState = (phoneNumber) => {
  if (!userState[phoneNumber]) {
    userState[phoneNumber] = {
      initialMessageSent: false,
      awaitingIssueId: false,
      awaitingUserQuestion: false,
      booksCheckedOut: []
    };
  }
  return userState[phoneNumber];
};

// Send initial menu message
async function sendInitialMessage(change, state) {
  try {
    const message = change.messages[0];
    const senderName = change.contacts[0].profile.name;
    const businessPhoneNumberId = change.metadata.phone_number_id;

    const body = `*📚 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\nIt is an auto-generated message!\n\n🌏 Website: https://library.ysmranchi.net\n🔍 OPAC Search: https://ysmranchi-opac.kohacloud.in\n\n*Press 📝 1: Renew your Book*\n*Press 📝 2: Library Repository*\n*Press 📝 3: Newspaper Archive*\n*Press 📝 4: Subject Catalogue*\n*Press 📝 5: Update Mobile Number*\n*Press 📝 6: Pragya: Knowledge Assistant*`;

    await axios.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: message.from,
        text: { body },
        context: { message_id: message.id },
      },
      { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
    );

    state.initialMessageSent = true;
  } catch (error) {
    console.error("Error sending initial message:", error.response?.data || error.message);
  }
}

// Fetch checkout history
async function fetchCheckOutHistoryReport() {
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await axios.get(
      'https://ysmranchi-opac.kohacloud.in/cgi-bin/koha/svc/report?id=94',
      { httpsAgent: agent }
    );

    if (response.status !== 200) throw new Error(response.statusText);

    return response.data;
  } catch (error) {
    console.error("Error fetching checkout report:", error.message);
    return [];
  }
}

// Handle option 1 (book renewal)
async function handleReplyOne(change, state) {
  try {
    const message = change.messages[0];
    const senderPhoneNumber = change.contacts[0].wa_id;
    const senderName = change.contacts[0].profile.name;
    const businessPhoneNumberId = change.metadata.phone_number_id;

    if (!state.awaitingIssueId) {
      const reportResults = await fetchCheckOutHistoryReport();
      const phoneNumber = senderPhoneNumber.replace(/^91/, '');
      state.booksCheckedOut = reportResults.filter(record => record[3] === phoneNumber);

      if (state.booksCheckedOut.length > 0) {
        let body = `Dear ${senderName},\n\n📔 Your checked-out books:\n\n`;
        state.booksCheckedOut.forEach((record, i) => {
          const dueDate = record[0] || 'Unknown';
          const authorName = record[6] || 'Unknown';
          const bookTitle = record[5] || 'Unknown';
          const barcode = record[8] || 'Unknown';
          const issueId = record[10] || 'Unknown';
          const dueDays = moment(dueDate, "YYYY-MM-DD").diff(moment(), 'days');
          body += `\n\📖 *${i+1}. ${bookTitle}*\n   *Author:* ${authorName}\n   *Due:* ${dueDate} (${dueDays} Days)\n   *Barcode:* ${barcode}\n   *Issue ID:* ${issueId}\n`;
        });
        body += `\n🚨 Reply with *exit* to return to the main menu or serial number to renew.`;

        await axios.post(
          `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          { messaging_product: "whatsapp", to: message.from, text: { body }, context: { message_id: message.id } },
          { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
        );

        state.awaitingIssueId = true;
      } else {
        await axios.post(
          `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          {
            messaging_product: "whatsapp",
            to: message.from,
            text: { body: `No check-out history found for ${senderName}. Please visit the library or update your WhatsApp number.` },
            context: { message_id: message.id }
          },
          { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
        );
      }
    } else {
      const userReply = message.text.body.trim();
      const index = parseInt(userReply) - 1;
      if (index >= 0 && index < state.booksCheckedOut.length) {
        const selectedBook = state.booksCheckedOut[index];
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
          const successMessage = `Success! 🎉\n📚 "${bookTitle}" renewed.\nNew due: *${newDueDate}*\nType *exit* to return to menu.`;

          await axios.post(
            `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
            { messaging_product: "whatsapp", to: message.from, text: { body: successMessage }, context: { message_id: message.id } },
            { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
          );

        } catch (error) {
          await axios.post(
            `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
            { messaging_product: "whatsapp", to: message.from, text: { body: `❌ Error: Maximum renewal reached. Return the book.` }, context: { message_id: message.id } },
            { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
          );
        }

      } else {
        await axios.post(
          `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          { messaging_product: "whatsapp", to: message.from, text: { body: `❌ Invalid serial number. Type *exit* to return.` }, context: { message_id: message.id } },
          { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
        );
      }

      state.awaitingIssueId = false;
    }

  } catch (error) {
    console.error("Error handleReplyOne:", error.response?.data || error.message);
  }
}

// Handle static options 2-6
async function handleStaticMessage(change, option, state) {
  const message = change.messages[0];
  const senderName = change.contacts[0].profile.name;
  const businessPhoneNumberId = change.metadata.phone_number_id;

  let responseMessage = "Invalid option";
  switch(option){
    case "2": responseMessage = `🌏 Repository: https://library.ysmranchi.net/dspace`; break;
    case "3": responseMessage = `🌏 Newspaper Archive: https://ysmcentallibrary.infinityfreeapp.com/result.php`; break;
    case "4": responseMessage = `🌏 Subject Catalogue: https://library.ysmranchi.net/catalouge/book.php`; break;
    case "5": responseMessage = `🌏 Update Mobile Number: https://library.ysmranchi.net/update/index.php`; break;
    case "6":
      responseMessage = `📝 Learning Mode. Type your questions. Type *exit* to return.`;
      state.awaitingUserQuestion = true;
      break;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      { messaging_product: "whatsapp", to: message.from, text: { body: responseMessage }, context: { message_id: message.id } },
      { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
    );
  } catch(e){
    console.error("Error handleStaticMessage:", e.response?.data || e.message);
  }
}

// ChatGPT response
async function getChatGPTResponse(userMessage){
  try{
    const response = await axios.post("https://api.openai.com/v1/chat/completions",
      { model: "gpt-3.5-turbo", messages: [{ role: "user", content: userMessage }] },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
    );

    let chatGPTResponse = response.data.choices[0].message.content;
    chatGPTResponse = `💬 ${chatGPTResponse}\n\n🚪 Type *exit* to close chat session.\n*Designed by Central Library*`;
    return chatGPTResponse;
  } catch(e){
    console.error("Error ChatGPT:", e.response?.data || e.message);
    return "Sorry, I couldn't process your request.";
  }
}

// Track per-user state
let userState = {}; // key = phoneNumber

// Optional: track message statuses globally
let messageStatus = {}; // key = messageId

// Webhook POST
app.post("/webhook", async (req, res) => {
  const change = req.body.entry?.[0]?.changes[0]?.value;
  if (!change) return res.sendStatus(200);

  // 1️⃣ Handle incoming messages
  const message = change.messages?.[0];
  if (message) {
    const senderPhoneNumber = change.contacts[0]?.wa_id;
    const state = getUserState(senderPhoneNumber);

    try {
      if (!state.initialMessageSent) {
        await sendInitialMessage(change, state);
      } else if (state.awaitingIssueId || message.text.body.trim() === "1") {
        await handleReplyOne(change, state);
      } else if (state.awaitingUserQuestion) {
        const userQuestion = message.text.body.trim();
        if (userQuestion.toLowerCase() === "exit") {
          state.awaitingUserQuestion = false;
          await sendInitialMessage(change, state);
        } else {
          const chatGPTResponse = await getChatGPTResponse(userQuestion);
          const businessPhoneNumberId = change.metadata.phone_number_id;
          const sentMsg = await axios.post(
            `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
            { messaging_product: "whatsapp", to: message.from, text: { body: chatGPTResponse }, context: { message_id: message.id } },
            { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
          );
          // Store message ID for tracking
          messageStatus[sentMsg.data.messages[0].id] = { status: "sent", to: message.from };
        }
      } else if (["2", "3", "4", "5", "6"].includes(message.text.body.trim())) {
        await handleStaticMessage(change, message.text.body.trim(), state);
      } else {
        await sendInitialMessage(change, state);
      }

      // Mark as read
      const businessPhoneNumberId = change.metadata.phone_number_id;
      await axios.post(
        `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
        { messaging_product: "whatsapp", status: "read", message_id: message.id },
        { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
      );

    } catch (e) {
      console.error("Webhook processing error:", e.response?.data || e.message);
    }
  }

  // 2️⃣ Handle message status updates (sent, delivered, read)
  const statuses = change.statuses;
  if (statuses && statuses.length > 0) {
    statuses.forEach(status => {
      console.log(`📦 Message Status -> ID: ${status.id}, To: ${status.recipient_id}, Status: ${status.status}, Timestamp: ${status.timestamp}`);
      // Update global messageStatus object
      messageStatus[status.id] = { to: status.recipient_id, status: status.status, timestamp: status.timestamp };
    });
  }

  res.sendStatus(200);
});


// Webhook GET verification
app.get("/webhook", (req,res)=>{
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if(mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN){
    res.status(200).send(challenge);
    console.log("Webhook verified!");
  } else res.sendStatus(403);
});

app.get("/", (req,res)=>{
  res.send(`<pre>Received Data:\n${JSON.stringify(userState,null,2)}</pre>`);
});

app.listen(PORT, ()=>console.log(`Server listening on port ${PORT}`));
