import express from "express";
import axios from "axios";
import https from "https";
import moment from "moment";

const app = express();
app.use(express.json());

// ENV config
const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PORT } = process.env;
const OPENAI_API_KEY = "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx"; // replace with your key

// Global state
let userState = {}; // track user mode per phone number
let booksCheckedOut = [];

// ✅ Helper: Send WhatsApp Message
async function sendWhatsappMessage(to, body, replyTo = null) {
  try {
    const businessPhoneNumberId = process.env.BUSINESS_PHONE_ID;
    const data = {
      messaging_product: "whatsapp",
      to,
      text: { body },
    };
    if (replyTo) data.context = { message_id: replyTo };

    await axios.post(
      `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      data,
      { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } }
    );
  } catch (err) {
    console.error("Error sending WhatsApp message:", err.response?.data || err);
  }
}

// ✅ Fetch Koha Report #94
async function fetchCheckOutHistoryReport() {
  const agent = new https.Agent({ rejectUnauthorized: false });
  const response = await axios.get(
    "https://ysmranchi-opac.kohacloud.in/cgi-bin/koha/svc/report?id=94",
    { httpsAgent: agent }
  );
  return response.data;
}

// ✅ Handle Option 1 (Book History + Renewal)
async function handleReplyOne(message, senderPhoneNumber, senderName) {
  const phoneNumber = senderPhoneNumber.replace(/^91/, "");
  const reportResults = await fetchCheckOutHistoryReport();

  booksCheckedOut = reportResults.filter((record) => record[3] === phoneNumber);

  if (booksCheckedOut.length > 0) {
    let msg = `Dear ${senderName},\n\n📔 Books checked out in your name:\n`;

    booksCheckedOut.forEach((record, i) => {
      const dueDate = record[0] || "Unknown";
      const bookTitle = record[5] || "Unknown";
      const authorName = record[6] || "Unknown";
      const barcode = record[8] || "Unknown";
      const issueId = record[10] || "Unknown";

      const dueDays = moment(dueDate, "YYYY-MM-DD").diff(moment(), "days");

      msg += `\n📖 *${i + 1}. ${bookTitle}*\n   👤 ${authorName}\n   ⏳ Due: ${dueDate} (${dueDays} days)\n   🏷 Barcode: ${barcode}\n   🆔 Issue ID: ${issueId}\n`;
    });

    msg += `\n🕒 Reply with *serial number* (e.g., 1) to renew a book.\n🚪 Type *exit* to return to menu.`;

    await sendWhatsappMessage(message.from, msg, message.id);
    userState[message.from] = { step: "renew" };
  } else {
    await sendWhatsappMessage(
      message.from,
      `*No check-out history* found for ${senderName}.\n\n📚 Visit the library to issue books, or update your WhatsApp number:\nhttps://library.ysmranchi.net/update/index.php`,
      message.id
    );
  }
}

// ✅ Handle Renewal Request
async function handleRenewal(message, userReply) {
  const index = parseInt(userReply) - 1;
  if (index >= 0 && index < booksCheckedOut.length) {
    const selectedBook = booksCheckedOut[index];
    const issueId = selectedBook[10];
    const bookTitle = selectedBook[5];
    const barcode = selectedBook[8];

    const url = `https://ysmranchi-staff.kohacloud.in/api/v1/checkouts/${issueId}/renewals`;

    try {
      const response = await axios.post(
        url,
        {},
        {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from("souravnag:@Yss132989").toString("base64"),
          },
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        }
      );

      const newDueDate = response.data.due_date;
      await sendWhatsappMessage(
        message.from,
        `✅ Renewed!\n📚 "${bookTitle}" (${barcode})\n📆 New due: ${newDueDate}\n🚪 Type *exit* to return to menu.`,
        message.id
      );
    } catch (err) {
      await sendWhatsappMessage(
        message.from,
        `❌ Renewal failed. Maximum limit reached. Please return the book.\n🚪 Type *exit* to return to menu.`,
        message.id
      );
    }
  } else {
    await sendWhatsappMessage(
      message.from,
      `❌ Invalid number. Reply again or type *exit* 🚪.`,
      message.id
    );
  }
}

// ✅ Handle Options 2–6
async function handleStaticOptions(message, body) {
  switch (body) {
    case "2":
      await sendWhatsappMessage(
        message.from,
        "🌏 Repository: https://library.ysmranchi.net/dspace",
        message.id
      );
      break;
    case "3":
      await sendWhatsappMessage(
        message.from,
        "📰 Newspaper Archive: https://ysmcentallibrary.infinityfreeapp.com/result.php",
        message.id
      );
      break;
    case "4":
      await sendWhatsappMessage(
        message.from,
        "📖 Subject Catalogue: https://library.ysmranchi.net/catalouge/book.php",
        message.id
      );
      break;
    case "5":
      await sendWhatsappMessage(
        message.from,
        "📱 Update Mobile: https://library.ysmranchi.net/update/index.php",
        message.id
      );
      break;
    case "6":
      userState[message.from] = { step: "chat" };
      await sendWhatsappMessage(
        message.from,
        "🤖 *Pragya Knowledge Assistant*\n\nType your question.\n🚪 Type *exit* to return.",
        message.id
      );
      break;
    default:
      await sendWhatsappMessage(
        message.from,
        "Invalid option. Please try again.",
        message.id
      );
  }
}

// ✅ ChatGPT Integration
async function getChatGPTResponse(userMessage) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userMessage }],
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return response.data.choices[0].message.content;
}

// ✅ Webhook Receiver
app.post("/webhook", async (req, res) => {
  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
  const senderName =
    req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.profile?.name;
  const senderPhoneNumber =
    req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.wa_id;

  if (message?.type === "text") {
    const body = message.text.body.trim().toLowerCase();

    // Exit → reset state
    if (body === "exit") {
      userState[message.from] = { step: "menu" };
      await sendWhatsappMessage(
        message.from,
        `🏠 Main Menu:\n1️⃣ Check-out History\n2️⃣ Repository\n3️⃣ Newspaper Archive\n4️⃣ Subject Catalogue\n5️⃣ Update Mobile\n6️⃣ Pragya Assistant`,
        message.id
      );
    }

    // Renewal flow
    else if (userState[message.from]?.step === "renew") {
      await handleRenewal(message, body);
    }

    // ChatGPT flow
    else if (userState[message.from]?.step === "chat") {
      const reply = await getChatGPTResponse(body);
      await sendWhatsappMessage(message.from, reply, message.id);
    }

    // Menu options
    else {
      switch (body) {
        case "1":
          await handleReplyOne(message, senderPhoneNumber, senderName);
          break;
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
          await handleStaticOptions(message, body);
          break;
        default:
          await sendWhatsappMessage(
            message.from,
            `📚 Welcome to Central Library!\n\n🏠 Main Menu:\n1️⃣ Check-out History\n2️⃣ Repository\n3️⃣ Newspaper Archive\n4️⃣ Subject Catalogue\n5️⃣ Update Mobile\n6️⃣ Pragya Assistant`,
            message.id
          );
      }
    }
  }
  res.sendStatus(200);
});

// ✅ Webhook Verification
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === WEBHOOK_VERIFY_TOKEN
  ) {
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// ✅ Server
app.listen(PORT || 3000, () =>
  console.log(`Server running on port ${PORT || 3000}`)
);
