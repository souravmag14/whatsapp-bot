import express from "express";
import axios from "axios";
import https from "https";
import moment from "moment";

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PORT} = process.env;
// Replace the placeholder with your actual OpenAI API key
const { OPENAI_API_KEY } = process.env;


let receivedData = {
  message: "",
  senderName: "",
  senderPhoneNumber: ""
};

let initialMessageSent = false;
let awaitingIssueId = false;
let awaitingUserQuestion = false;
let booksCheckedOut = [];

async function sendInitialMessage(req) {
  try {
    const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
    const senderName = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.profile?.name;
    const senderPhoneNumber = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.wa_id;
    const businessPhoneNumberId = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;

    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        to: message.from,
        text: {
          body: `*📚 Welcome to Central Library,Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\nIt is an auto-generated Message!\n\n🌏 Please explore our website: https://library.ysmranchi.net \n\n🔍 For OPAC search, please visit: https://ysmranchi-opac.kohacloud.in.\n\n*Press 📝 1: for Renew your Book*\n*Press 📝 2: for Library Repository*\n*Press 📝 3: for Newspaper Archive*\n*Press 📝 4: for Subject Catalogue*\n*Press 📝 5: Update Mobile Number*\n*Press 📝 6: Pragya: Your Knowledge Assistant*`,
        },
        context: {
          message_id: message.id,
        },
      },
    });

    initialMessageSent = true;
  } catch (error) {
    console.error("Error sending initial message:", error);
  }
}

async function fetchCheckOutHistoryReport() {
  try {
    const agent = new https.Agent({
      rejectUnauthorized: false
    });

    const response = await axios.get('https://ysmranchi-opac.kohacloud.in/cgi-bin/koha/svc/report?id=94', {
      httpsAgent: agent
    });

    if (response.status !== 200) {
      throw new Error('Error fetching data: ' + response.statusText);
    }

    return response.data;
  } catch (error) {
    throw new Error('Error fetching data: ' + error.message);
  }
}

async function handleReplyOne(req) {
  try {
    if (!awaitingIssueId) {
      const reportResults = await fetchCheckOutHistoryReport();
      const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
      const senderPhoneNumber = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.wa_id;
      const senderName = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.profile?.name;
      const businessPhoneNumberId = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;

      const phoneNumber = senderPhoneNumber.replace(/^91/, ''); // Remove '91' country code
      booksCheckedOut = reportResults.filter(record => record[3] === phoneNumber);

      if (booksCheckedOut.length > 0) {
        let messageBody = `Dear ${senderName},\n\n📔 The following books are checked out in your name:\n`;

       messageBody += `\n🕒 *Please reply with the Serial Number to renew the corresponding book!* \n \n ⚠️ For example if you want to renew the first book; reply with *1*.`;

booksCheckedOut.forEach((record, index) => {
  const dueDate = record[0] || 'Unknown';
  const authorName = record[6] || 'Unknown';
  const bookTitle = record[5] || 'Unknown';
  const barcode = record[8] || 'Unknown'; // Assuming barcode is at index 8
  const issueId = record[10] || 'Unknown';

  const dueDays = moment(dueDate, "YYYY-MM-DD").diff(moment(), 'days');

  messageBody += `\n\n\📖 *${index + 1}. Book Title:* ${bookTitle}\n\n   *Author:* ${authorName}\n\n   *Due Date:* ${dueDate}\n   *Days to Overdue:* ${dueDays} Days\n   *Barcode:* ${barcode}\n   *Issue ID:* ${issueId}\n\n`;
});

messageBody += `\n 🚨 Reply with *exit* to return to the main menu`;
        

        await axios({
          method: "POST",
          url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          headers: {
            Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          },
          data: {
            messaging_product: "whatsapp",
            to: message.from,
            text: {
              body: messageBody,
            },
            context: {
              message_id: message.id,
            },
          },
        });

        awaitingIssueId = true;
      } else {
        await axios({
          method: "POST",
          url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          headers: {
            Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          },
          data: {
            messaging_product: "whatsapp",
            to: message.from,
            text: {
              body: `*📖 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\n *No check-out* history found in your Name.\n\n 📚Please visit Central Library, YSM with ID card to Issue Book.\n\n *OR* 🍃Your WhatsApp number is not updated in our Library. To check/update your WhatsApp number\n\n 🌏 Please click the link:\n\n https://library.ysmranchi.net/update \n\n🍃 "The only thing that you absolutely have to know, is the location of the library.🍃" --Albert Einstein`,
            },
            context: {
              message_id: message.id,
            },
          },
        });
      }
    } else {
      const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
      const senderPhoneNumber = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.wa_id;
      const businessPhoneNumberId = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;
      const userReply = message.text.body.trim();

      const index = parseInt(userReply) - 1;
      if (index >= 0 && index < booksCheckedOut.length) {
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
            headers: {
              'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
          });

          const newDueDate = response.data.due_date;
          const successMessage = `Success! 🎉\n📚 The book "${bookTitle}" with barcode "${barcode}" has been successfully renewed.\nNew due date: *${newDueDate}*\n\nType *exit* to return to the main menu.`;


          await axios({
            method: "POST",
            url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
            headers: {
              Authorization: `Bearer ${GRAPH_API_TOKEN}`,
            },
            data: {
              messaging_product: "whatsapp",
              to: message.from,
              text: {
                body: successMessage,
              },
              context: {
                message_id: message.id,
              },
            },
          });
        } catch (error) {
          console.error("Error renewing book:", error);
          await axios({
            method: "POST",
            url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
            headers: {
              Authorization: `Bearer ${GRAPH_API_TOKEN}`,
            },
            data: {
              messaging_product: "whatsapp",
              to: message.from,
              text: {
                body: `❌ *Error:* You have reached the Maximum Renewal Limits. Please return the Book!\n\nReply with *exit* to return to the main menu.`,
              },
              context: {
                message_id: message.id,
              },
            },
          });
        }
      } else {
        await axios({
          method: "POST",
          url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
          headers: {
            Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          },
          data: {
            messaging_product: "whatsapp",
            to: message.from,
            text: {
              body: `❌ *Error:* Invalid serial number. \nPlease type *exit* 🚪 and try with a valid serial number. 🔄`,
            },
            context: {
              message_id: message.id,
            },
          },
        });
      }

      awaitingIssueId = false;
    }
  } catch (error) {
    console.error("Error processing message:", error);
  }
}

async function handleStaticMessage(req, option) {
  try {
    const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
    const senderPhoneNumber = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.wa_id;
    const senderName = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0]?.profile?.name;
    const businessPhoneNumberId = req.body.entry?.[0]?.changes[0]?.value?.metadata?.phone_number_id;

    let responseMessage;
    switch (option) {
      case "2":
        responseMessage = `*📚 Welcome to Central Library,Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\n🌏 Please explore our Institutional Repository:\n\n https://library.ysmranchi.net/dspace`;
        break;
      case "3":
        responseMessage = `*📚 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\n🌏 Please explore our Newspaper Archive :\n\n https://ysmcentallibrary.infinityfreeapp.com/result.php`;
        break;
      case "4":
        responseMessage = `*📚 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\n🌏 Please explore our Subject Catalouge :\n\n https://library.ysmranchi.net/catalouge/book.php`;
        break;
      case "5":
        responseMessage = `*📚 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!*\n\n*Dear ${senderName}*,\n\n🌏 Please click the link to update Mobile Number :\n\n https://library.ysmranchi.net/update/index.php`;
        break;
      case "6":
        responseMessage = `📚 Welcome to Central Library, Yogoda Satsanga Mahavidyalaya!

*Dear ${senderName}*,\n\n📝 You are now in Learning Mode. Type your questions and I will provide answers. 

For example:\n*who invented the telephone?*  

Type *exit* to return to the main menu.

Type your question below:`;

        awaitingUserQuestion = true;
        break;
      default:
        responseMessage = "Invalid option.";
        break;
    }

    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        to: message.from,
        text: {
          body: responseMessage,
        },
        context: {
          message_id: message.id,
        },
      },
    });
  } catch (error) {
    console.error("Error handling static message:", error);
  }
}

async function getChatGPTResponse(userMessage) {
  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userMessage }],
    }, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    let chatGPTResponse = response.data.choices[0].message.content;
    // Adding an emoji at the beginning of the response
    chatGPTResponse = `💬 ${chatGPTResponse}`;
    // Splitting the response into lines
    const lines = chatGPTResponse.split('\n');
    // Taking only the first 10 lines
    chatGPTResponse = lines.slice(0, 1).join('\n');
    // Adding a message to type 'exit' to close the chat session with a bold format and emoji
    chatGPTResponse += `\n\n🚪 Type *exit* to close the chat session.\n\n *Designed by Central Library*`;
    
    return chatGPTResponse;
  } catch (error) {
    console.error("Error getting ChatGPT response:", error);
    return "Sorry, I couldn't process your request at the moment.";
  }
}

app.post("/webhook", async (req, res) => {
  const change = req.body.entry?.[0]?.changes[0]?.value;
  const message = change?.messages?.[0];

  // --- Log incoming text messages ---
  if (message?.type === "text") {
    console.log(`📨 Message received from ${message.from}: ${message.text.body}`);

    // Update your receivedData
    receivedData.message = message.text.body;
    receivedData.senderPhoneNumber = change?.contacts?.[0]?.wa_id;
    receivedData.senderName = change?.contacts?.[0]?.profile?.name;

    const businessPhoneNumberId = change?.metadata?.phone_number_id;

    try {
      if (!initialMessageSent) {
        await sendInitialMessage(req);
      } else if (awaitingIssueId) {
        await handleReplyOne(req);
      } else if (awaitingUserQuestion) {
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
            context: { message_id: message.id },
          }, { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } });
        }
      } else {
        const selectedOption = message.text.body.trim().toLowerCase();
        if (selectedOption === "1") {
          await handleReplyOne(req);
        } else if (["2","3","4","5","6"].includes(selectedOption)) {
          await handleStaticMessage(req, selectedOption);
        } else if (!isNaN(selectedOption)) {
          await handleReplyOne(req);
        } else {
          await sendInitialMessage(req);
        }
      }

      // Mark message as read
      await axios.post(`https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: message.id,
      }, { headers: { Authorization: `Bearer ${GRAPH_API_TOKEN}` } });

    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  // --- Log incoming message statuses ---
  const statuses = change?.statuses;
  if (statuses && statuses.length > 0) {
    statuses.forEach(status => {
      console.log(`📦 Message Status -> ID: ${status.id}, To: ${status.recipient_id}, Status: ${status.status}, Timestamp: ${status.timestamp}`);
    });
  }

  res.sendStatus(200);
});

      await axios({
        method: "POST",
        url: `https://graph.facebook.com/v18.0/${businessPhoneNumberId}/messages`,
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
        },
        data: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: message.id,
        },
      });
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  res.sendStatus(200);
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    console.log("Webhook verified successfully!");
  } else {
    res.sendStatus(403);
  }
});

app.get("/", (req, res) => {
  res.send(`<pre>Received Data:\n${JSON.stringify(receivedData, null, 2)}</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});
