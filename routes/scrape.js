const express = require("express");
const OpenAI = require("openai");
const stopword = require("stopword");
const Website = require("../db/models/Website");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

module.exports = (context) => {
  const router = express.Router();
  router.post("/", async (req, res) => {
    const url = req.body.url;
    const token = req.headers.authorization.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify the token and extract the user ID
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // Ensure you have JWT_SECRET in your environment variables
    const userId = decoded.id; // This assumes that your token contains an 'id' field

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    let page;

    try {
      page = await context.newPage();

      await navigateWithRetry(page, url);

      const title = await page.title();

      // Gracefully handle missing meta description
      const descriptionElement = await page.$('meta[name="description"]');
      let description = "";
      if (descriptionElement) {
        description = await page.$eval(
          'meta[name="description"]',
          (element) => element.content
        );
      } else {
        console.log("Description meta tag not found.");
      }

      let headings = await page.$$eval("h1, h2, h3, h4, h5, h6", (elements) =>
        elements
          .map((el) => el.innerText.trim())
          .filter((text) => text.length > 0)
      );

      let paragraphs = await page.$$eval("p", (elements) =>
        elements
          .map((el) => el.innerText.trim())
          .filter((text) => text.length > 0)
      );

      let lists = await page.$$eval("ul, ol", (elements) =>
        elements
          .map((el) => el.innerText.trim())
          .filter((text) => text.length > 0)
      );

      let rawText = await page.$$eval("div, span", (elements) =>
        elements
          .map((el) => el.innerText.trim())
          .filter((text) => text.length > 0)
      );

      //links from a tags and buttons
      // Extract links from <a>, <button>, and elements with onclick attributes
      let linksWithTitles = await page.$$eval(
        "a, button, [onclick], [data-link]",
        (elements) =>
          elements
            .map((el) => {
              let link = "";
              let title =
                el.innerText.trim() ||
                el.getAttribute("title") ||
                el.getAttribute("aria-label");

              // Get href from <a> tags
              if (el.tagName.toLowerCase() === "a" && el.href) {
                link = el.href;
              }

              // Get links from buttons with data-link or onclick attributes
              if (el.tagName.toLowerCase() === "button") {
                if (el.dataset.link) {
                  link = el.dataset.link; // Custom data-link attribute
                } else if (el.onclick) {
                  const match = el.onclick
                    .toString()
                    .match(/https?:\/\/[^\s"]+/);
                  if (match) link = match[0];
                }
              }

              // Get links from elements with onclick attributes
              if (el.hasAttribute("onclick")) {
                const match = el
                  .getAttribute("onclick")
                  .match(/https?:\/\/[^\s"]+/);
                if (match) link = match[0];
              }

              // Return object with both link and title
              return link.trim() ? { link, title: title || link } : null;
            })
            .filter((item) => item)
      );

      const bestImages = await page.$$eval(
        "img",
        (elements) =>
          elements
            .filter((el) => el !== null) // Filter out null elements
            .map((el) => {
              const src = el?.src;
              const alt = el?.alt || "";
              const width = el?.naturalWidth || 0;
              const height = el?.naturalHeight || 0;

              if (!src || alt === "" || width === 0 || height === 0) {
                return null;
              }

              const area = width * height;
              return { src, alt, area };
            })
            .filter((img) => img !== null && img.area > 0) // Filter out null values and images with no area
            .sort((a, b) => b.area - a.area) // Sort images by area (descending)
            .slice(0, 10) // Take the top 10 images
      );

      console.log("Best images:", bestImages);

      // use at maximum 10 paragraphs, 20 raw text, 10 headings, 10 lists
      headings = headings.slice(0, 50);
      paragraphs = paragraphs.slice(0, 50);
      lists = lists.slice(0, 50);
      rawText = rawText.slice(0, 50);
      linksWithTitles = linksWithTitles.slice(0, 15);

      const filteredHeadings = await cleanAndFilterContent(headings);
      const filteredParagraphs = await cleanAndFilterContent(paragraphs);
      const filteredLists = await cleanAndFilterContent(lists);
      const filteredRawText = await cleanAndFilterContent(rawText);

      const openAISummary = await summarizeWithOpenAI(
        url,
        title,
        description,
        filteredHeadings,
        filteredLists,
        filteredRawText,
        linksWithTitles,
        bestImages
      );

      //replace  the website data from the database if it already exists

      const existingWebsite = await Website.findOne({
        userId: userId,
        websiteLink: url,
      });

      if (existingWebsite) {
        console.log("Website already exists, updating the data");
        existingWebsite.website = openAISummary;
        await existingWebsite.save();
        console.log("Updated");
        return res.json(openAISummary);
      }

      const summaryData = new Website({
        userId: userId,
        websiteLink: url,
        website: openAISummary,
      });

      console.log("Saving data to MongoDB");
      await summaryData.save();
      console.log("Saved");

      if (openAISummary === "") {
        return res.status(500).json({ error: "Response is empty" });
      }

      res.json(openAISummary);
    } catch (error) {
      console.error("Error during scraping:", error);
      res.status(500).json({ error: "Internal Server Error: ", error });
    } finally {
      if (page) {
        await page.close();
      }
    }
  });
  //
  router.get("/history", async (req, res) => {
    try {
      const token = req.headers.authorization.split(" ")[1];

      if (!token) {
        return res.status(401).json({ error: "No token provided" });
      }

      // Verify the token and extract the user ID
      const decoded = jwt.verify(token, process.env.JWT_SECRET); // Ensure you have JWT_SECRET in your environment variables
      const userId = decoded.id; // This assumes that your token contains an 'id' field

      // Find the websites related to this user
      const websites = await Website.find({ userId: userId }); // Assuming you have a 'user' field in your Website model that stores the user's ID
      res.json(websites);
    } catch (error) {
      console.error("Error fetching websites:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  router.delete("/history", async (req, res) => {
    try {
      const token = req.headers.authorization.split(" ")[1];

      if (!token) {
        return res.status(401).json({ error: "No token provided" });
      }

      // Verify the token and extract the user ID
      const decoded = jwt.verify(token, process.env.JWT_SECRET); // Ensure you have JWT_SECRET in your environment variables
      const userId = decoded.id; // This assumes that your token contains an 'id' field

      // Delete all websites related to this user
      await Website.deleteMany({ userId: userId }); // Assuming you have a 'user' field in your Website model that stores the user's ID
      res.json({ message: "Deleted all websites" });
    } catch (error) {
      console.error("Error deleting websites:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  async function cleanAndFilterContent(textArray) {
    const cleanedTextArray = textArray
      .map((text) => {
        text = text.toLowerCase();
        text = text.replace(/[^a-z\s]/g, "");
        let words = text.split(/\s+/);
        words = stopword.removeStopwords(words);
        return words.join(" ").trim();
      })
      .filter((cleanedText) => cleanedText.length > 0);
    return cleanedTextArray;
  }

  async function summarizeWithOpenAI(
    websiteLink,
    title,
    description,
    headings,
    lists,
    rawText,
    usefulLinks,
    bestImages
  ) {
    const headingsContent = headings.join(",");
    const listsContent = lists.join(",");

    let content = [
      `Website: ${websiteLink}`,
      `Title: ${title}`,
      `Description: ${description}`,
      `Headings: ${headingsContent}`,
      `Lists: ${listsContent}`,
      `Raw Text: ${rawText}`,
      `Useful Links: ${usefulLinks
        .map((link) => {
          return `${link.title} - ${link.link}`;
        })
        .join(",")},`,
      `Best Images: ${bestImages
        .map((img) => {
          return `image alt - ${img.alt}, image src - ${img.src}`;
        })
        .join(",")}`,
    ];

    try {
      let prompt = `Please web scrape following website: \n${content}.
      
      `;
      let systemPrompt = `You are a web scraper expert.
         Provide a brief and concise summary of the website content, the categories/labels it falls (sports, blog, e-commerce, paper, news, etc), the best images if any, the key points of the content as lists of titles and values, providing a brief description of each and useful links if any or useful, lastly, provide related content (similar best real websites) if any. 
         Focusing only on key points and avoiding unnecessary details.
         \nIf  you can't summarize the content or find a category, return the respective key as empty string. 
          Always return your response in the following strict JSON format without any additional text or commentary:
          { 
            "website" : [{
              "name" : "str",
              "summary": "str",
              "labels": [str],
              "images": [{
                "src": "str",
                "alt": "str",
              }],
              "keyPoints": [
                {
                  "title": [str],
                  "value": [str],
                }
              ],
              "useFullLinks": [{
                "title": "str",
                "url": "str"
              }],
              "relatedContent": [{
                "title": "str",
                "url": "str"
              }]
            }]
          }

         `;
      const messageContent = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      console.log(
        "OpenAI response:",
        messageContent.choices[0].message.content
      );

      // Extract the JSON content
      const jsonString = messageContent.choices[0].message.content;

      // Parse the JSON string to ensure it's valid JSON
      const jsonResponse = JSON.parse(jsonString);

      return jsonResponse;
    } catch (error) {
      console.error("Error during OpenAI summarization:", error);
      return "Error during OpenAI summarization";
    }
  }

  const navigateWithRetry = async (page, url, retries = 3, timeout = 60000) => {
    for (let i = 0; i < retries; i++) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: timeout });
        return; // If successful, exit the function
      } catch (error) {
        console.error(
          `Error during page navigation (attempt ${i + 1}):`,
          error
        );
        if (i === retries - 1) {
          throw error; // Throw error if last attempt fails
        }
        console.log(`Retrying... (${i + 1}/${retries})`);
      }
    }
  };
  return router;
};
