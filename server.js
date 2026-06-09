const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Frontend URL — env var or localhost fallback ─────────
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://deploykar.vercel.app",
    FRONTEND_URL,
  ],
  credentials: true,
}));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "Deploykar backend running! 🚀" });
});

// ─── GitHub OAuth redirect ────────────────────────────────
app.get("/auth/github", (req, res) => {
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo,user`;
  res.redirect(githubAuthUrl);
});

// ─── GitHub OAuth callback ────────────────────────────────
app.get("/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) return res.redirect(`${FRONTEND_URL}?error=auth_failed`);
    res.redirect(`${FRONTEND_URL}?token=${accessToken}`);
  } catch (err) {
    console.error("OAuth error:", err.message);
    res.redirect(`${FRONTEND_URL}?error=server_error`);
  }
});

// ─── User info ────────────────────────────────────────────
app.get("/api/user", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const userRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json(userRes.data);
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// ─── User repos ───────────────────────────────────────────
app.get("/api/repos", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const reposRes = await axios.get(
      "https://api.github.com/user/repos?sort=updated&per_page=20",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(reposRes.data);
  } catch (err) {
    res.status(400).json({ error: "Failed to fetch repos" });
  }
});

// ─── Deploy via Vercel API ────────────────────────────────
app.post("/api/deploy", async (req, res) => {
  const { repoUrl, framework } = req.body;
  const githubToken = req.headers.authorization?.split(" ")[1];
  if (!githubToken) return res.status(401).json({ error: "No token" });

  try {
    const repoPath = repoUrl.replace("https://github.com/", "").trim();
    const repoName = repoPath.split("/")[1];

    const repoInfoRes = await axios.get(
      `https://api.github.com/repos/${repoPath}`,
      { headers: { Authorization: `Bearer ${githubToken}` } }
    );
    const repoId = repoInfoRes.data.id;
    const defaultBranch = repoInfoRes.data.default_branch || "main";

    console.log(`Deploying: ${repoPath} (ID: ${repoId}, Branch: ${defaultBranch})`);

    const deployRes = await axios.post(
      "https://api.vercel.com/v13/deployments",
      {
        name: repoName,
        gitSource: {
          type: "github",
          repo: repoPath,
          ref: defaultBranch,
          repoId: String(repoId),
        },
        projectSettings: {
          framework:
            framework === "React / Vite" ? "vite" :
            framework === "Next.js" ? "nextjs" :
            framework === "Node.js" ? null : null,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      success: true,
      deploymentId: deployRes.data.id,
      url: deployRes.data.url,
      status: deployRes.data.readyState,
    });

  } catch (err) {
    console.error("Deploy error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Deploy failed",
      details: err.response?.data?.error?.message || err.message,
    });
  }
});

// ─── Deploy status check ──────────────────────────────────
app.get("/api/deploy-status/:deploymentId", async (req, res) => {
  const { deploymentId } = req.params;
  try {
    const statusRes = await axios.get(
      `https://api.vercel.com/v13/deployments/${deploymentId}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } }
    );
    res.json({ status: statusRes.data.readyState });
  } catch (err) {
    res.status(500).json({ error: "Status check failed" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Deploykar backend running on http://localhost:${PORT}`);
  console.log(`🌍 Frontend URL: ${FRONTEND_URL}`);
});