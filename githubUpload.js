const { Octokit } = require("@octokit/rest");
const fs = require("fs");
require("dotenv").config();

// GitHub configuration
const token = process.env.GITHUB_TOKEN; // Replace with your token
const REPO_OWNER = "Ogero79"; // Your GitHub username
const REPO_NAME = "eduhub-uploads"; // Repository name
const BRANCH_NAME = "main"; // Branch where files will be uploaded

// Initialize Octokit (GitHub API client)
const octokit = new Octokit({ auth: token });

// Function to upload a file to GitHub
const uploadFileToGitHub = async (fileName, fileContent) => {
  try {
    // Check if the file already exists
    const { data: existingFile } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: fileName,
    }).catch(() => ({ data: null }));

    const sha = existingFile?.sha; // File's SHA if it already exists

    // Upload or update the file
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      branch: BRANCH_NAME,
      path: fileName,
      message: `Upload file: ${fileName}`,
      content: Buffer.from(fileContent).toString("base64"), // Convert content to Base64
      sha: sha, // Include SHA if updating an existing file
    });

    console.log(`File uploaded successfully: ${response.data.content.html_url}`);
    return response.data.content.download_url; // Direct link to the file
  } catch (error) {
    console.error("Error uploading file to GitHub:", error.message);
    throw error;
  }
};

module.exports = { uploadFileToGitHub };
