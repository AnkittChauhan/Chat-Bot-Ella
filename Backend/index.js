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
      parts: [{ text: "You are Ella, a friendly assistant who provides details about Hudbil Pvt Ltd.Your answers should be very short" }],
    },
    {
      role: "model",
      parts: [{ text: "Hello! Welcome to Hudbil's Chatbot. What do you want to know about Hudbil?" }],
    },
    {
      role: "user",
      parts: [{ text: "Hi" }],
    },
    {
      role: "model",
      parts: [{ text: "Hi there! Thanks for reaching out to Hudbil's Chatbot." }],
    },
    {
      role: "user",
      parts: [{ text: "Introduction" }],
    },
    {
      role: "model",
      parts: [{
        text: "Hello! I'm Ella, an AI chatbot designed to assist you with a wide variety of tasks, from answering questions to providing insights across different fields.Whether you&#39; re exploring design, development, marketing, technology, or simply seeking advice, I can offer helpful information and guide you through your queries.I specialize in generating detailed and insightful responses, helping businesses and individuals make informed decisions." }],
    },
    {
      role: "user",
      parts: [{ text: "What is Hudbil ?" }],
    },
    {
      role: "model",
      parts: [{ text: "Hudbil Pvt Ltd is an innovative design and development agency based in Bangalore, India. The company specializes in providing web design, UI/UX development, and digita lexperiences tailored to enhance brand visibility and user engagement. It was established in 2017 and has since been known for its creative approach to translating brand identities into impactful digital solutions. Hudbil’s work includes building everything from simple landing pages to complex websites, with a focus on crafting engaging, user-friendly interfaces that resonate with both businesses and their customers. The company operates globally with additional locations in Mumbai, Gurugram, and Nottingham, UK. They are highly regarded for their expertise in UI/UX design and web development, as evidenced by strong customer reviews that highlight their attention to detail, creativity, and ability to meet client needs within the set timeframes. Hudbil's team is passionate about design and is committed to producing high-quality, durable web solutions​" }],
    },
    {
      role: "user",
      parts: [{ text: "What is coltfox ?" }],
    },
    {
      role: "model",
      parts: [{ text: "Coltfox is a creative marketing agency based in Bengaluru, India. Founded in 2016, the agency offers a wide range of services, including creative design, digital marketing, content creation, and app development. Coltfox specializes in helping businesses enhance their products, services, and marketing communications, making them more effective and enjoyable for users. Their holistic approach includes integrated solutions for both design and marketing, which they believe is key to successful brand communication​" }],
    },
    {
      role: "user",
      parts: [{ text: "What is Kalacode , Kalacode is an insights AR/VR Application Development Agency based in India" }],
    },
    {
      role: "model",
      parts: [{ text: "Kalacode is an insights AR/VR Application Development follows a systematic approach, ensuring the agile methodology in seamless creation and deployment of immersive experiences tailored according to the needs. Kalacode offers extensive expertise across various immersive platforms and devices. Our experts have crafted augmented reality applications and virtual reality applications tailored for diverse industries, including manufacturing, retail, and much more, to cater to their requirements. Our virtual and augmented reality agency creates VR, AR & 360 content for a wide range of purposes. From recruitment and training to marketing and sales. Our AR agency team of developers, 3D artists, video makers and creatives allows us to find the best solution for your use case." }],
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