const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const dotenv = require('dotenv').config();

const app = express();
const port = process.env.PORT || 5174;
const MODEL_NAME = "gemini-pro";
const API_KEY = process.env.API_KEY;

app.use(cors());
app.use(express.json());


async function runChat(userInput) {

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 1000,
  };

  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
  ];


  const chatHistory = [
    {
      role: "user",
      parts: [{ text: "You are Ella, a friendly assistant.Your answers should be very short" }],
    },
    {
      role: "model",
      parts: [{ text: "Hello! Welcome to Chatbot ella. What do you want to Know about" }],
    },
    {
      role: "user",
      parts: [{ text: "Hi" }],
    },
    {
      role: "model",
      parts: [{ text: "Hi there! i am you friendly assistant Chatbot." }],
    },
    {
      role: "user",
      parts: [{ text: "Introduction" }],
    },
    {
      role: "model",
      parts: [{
        text: "Hello! I'm Ella, an AI chatbot designed to assist you with a wide variety of tasks. and answer your queries" }],
    },
  ];

  const chat = model.startChat({
    generationConfig,
    safetySettings,
    history: chatHistory,
  });

  const result = await chat.sendMessage(userInput);
  return result.response.text();
}

app.post('/chat', async (req, res) => {
  const { userInput } = req.body;

  if (!userInput) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const response = await runChat(userInput);
    res.json({ response });
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});