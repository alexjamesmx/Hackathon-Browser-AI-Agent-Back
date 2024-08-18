const express = require("express");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const scrapeRouter = require("./routes/scrape"); // Importar la ruta scrape
const authRouter = require("./routes/auth");
const { initializeBrowser } = require("./utils/browser");
const cors = require("cors");
const { protect } = require("./routes/middlewares/authMiddleware");

dotenv.config();

async function startServer() {
  const app = express();

  app.use(express.json());
  app.use(
    cors({
      origin: "*",
    })
  );

  app.get("/", (req, res) => {
    res.send("Hello World");
  });

  // Initialize browser and context
  const { context } = await initializeBrowser();

  // Pass the context to the scrape router
  app.use("/scrape", protect, scrapeRouter(context)); // Protect all routes under "/scrape"
  app.use("/auth", authRouter);

  // Connect to MongoDB
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.log(err));

  app.listen(process.env.PORT || 3001, () => {
    console.log(`Server is running on port ${process.env.PORT || 3001}`);
  });
}

startServer().catch((err) => {
  console.error("Error starting the server:", err);
});
