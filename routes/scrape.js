const express = require("express");
const OpenAI = require("openai");
const stopword = require("stopword");
const dotenv = require("dotenv");

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = (context) => {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const url = req.body.url;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    let page;
    try {
      page = await context.newPage();

      // Retry navigation logic
      await navigateWithRetry(page, url);

      const title = await page.title();

      // Collect metadata, headings, paragraphs, lists, and links in parallel
      const [
        description,
        headings,
        paragraphs,
        lists,
        linksWithTitles,
        bestImages,
      ] = await Promise.all([
        getMetaDescription(page),
        getElementsText(page, "h1, h2, h3, h4, h5, h6", 10),
        getElementsText(page, "p", 10),
        getElementsText(page, "ul, ol", 10),
        getLinks(page, 10),
        getBestImages(page, 5),
      ]);

      // Summarize with OpenAI
      const openAISummary = await summarizeWithOpenAI({
        url,
        title,
        description,
        headings,
        paragraphs,
        lists,
        linksWithTitles,
        bestImages,
      });

      if (!openAISummary) {
        return res.status(500).json({ error: "Failed to generate summary" });
      }

      res.json(openAISummary);
    } catch (error) {
      console.error("Error during scraping:", error);
      res.status(500).json({ error: "Internal Server Error" });
    } finally {
      if (page) await page.close();
    }
  });

  async function getMetaDescription(page) {
    const descriptionElement = await page.$('meta[name="description"]');
    if (!descriptionElement) return "";
    return page.$eval('meta[name="description"]', (el) => el.content);
  }

  async function getElementsText(page, selector, limit) {
    return page.$$eval(selector, (elements) =>
      elements
        .map((el) => el.innerText.trim())
        .filter((text) => text.length > 0)
        .slice(0, limit)
    );
  }

  async function getLinks(page, limit) {
    return page.$$eval("a, button", (elements) =>
      elements
        .map((el) => {
          const link = el.href || el.dataset.link || "";
          const title = el.innerText.trim() || el.getAttribute("title") || link;
          return link ? { title, link } : null;
        })
        .filter((item) => item)
        .slice(0, limit)
    );
  }

  async function getBestImages(page, limit) {
    return page.$$eval("img", (elements) =>
      elements
        .map((el) => {
          const src = el.src || "";
          const alt = el.alt || "";
          const area = (el.naturalWidth || 0) * (el.naturalHeight || 0);
          return src && area > 0 ? { src, alt, area } : null;
        })
        .filter((img) => img)
        .sort((a, b) => b.area - a.area)
        .slice(0, limit)
    );
  }

  async function summarizeWithOpenAI(data) {
    const {
      url,
      title,
      description,
      headings,
      paragraphs,
      lists,
      linksWithTitles,
      bestImages,
    } = data;

    const prompt = `
Website: ${url}
Title: ${title}
Description: ${description}
Headings: ${headings.join(", ")}
Paragraphs: ${paragraphs.join(", ")}
Lists: ${lists.join(", ")}
Links: ${linksWithTitles
      .map((link) => `${link.title} (${link.link})`)
      .join(", ")}
Images: ${bestImages.map((img) => `${img.alt} (${img.src})`).join(", ")}
    `;

    try {
      const messageContent = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are an expert web scraper. Provide concise summaries and key information in strict JSON format.",
          },
          { role: "user", content: prompt },
        ],
      });

      return JSON.parse(messageContent.choices[0].message.content);
    } catch (error) {
      console.error("Error during OpenAI summarization:", error);
      return null;
    }
  }

  const navigateWithRetry = async (page, url, retries = 2, timeout = 30000) => {
    for (let i = 0; i < retries; i++) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        return;
      } catch (error) {
        console.error(`Navigation error (attempt ${i + 1}):`, error);
        if (i === retries - 1) throw error;
      }
    }
  };

  return router;
};
