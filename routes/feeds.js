const express = require("express");
const router = express.Router();
const pool = require("../db"); // Ensure this points to your PostgreSQL connection

router.get("/:courseId", async (req, res) => {
  const { courseId } = req.params;
  const { year, semester, studentId } = req.query;

  try {
    const feeds = await pool.query(
      `SELECT f.*,
        EXISTS (SELECT 1 FROM feed_likes WHERE student_id = $1 AND feed_id = f.feed_id) AS userLiked,
        EXISTS (SELECT 1 FROM feed_dislikes WHERE student_id = $1 AND feed_id = f.feed_id) AS userDisliked
      FROM feeds f
      WHERE f.course_id = $2 AND f.year = $3 AND f.semester = $4
      ORDER BY f.upload_date DESC`,
      [studentId, courseId, year, semester]
    );

    res.json(feeds.rows);
  } catch (err) {
    console.error("Error fetching feeds:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


router.put("/:feedId", async (req, res) => {
    const { feedId } = req.params;
    const { description } = req.body;
  
    try {
      const result = await pool.query(
        "UPDATE feeds SET description = $1 WHERE feed_id = $2 RETURNING *",
        [description, feedId]
      );
  
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating feed:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  
  router.delete("/:feedId", async (req, res) => {
    const { feedId } = req.params;
    
    try {
      await pool.query("DELETE FROM feeds WHERE feed_id = $1", [feedId]);
      res.json({ message: "Feed deleted successfully" });
    } catch (error) {
      console.error("Error deleting feed:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

router.post("/react", async (req, res) => {
  const { feedId, action, studentId } = req.body;

  try {
    const existingLike = await pool.query(
      "SELECT * FROM feed_likes WHERE student_id = $1 AND feed_id = $2",
      [studentId, feedId]
    );
    const existingDislike = await pool.query(
      "SELECT * FROM feed_dislikes WHERE student_id = $1 AND feed_id = $2",
      [studentId, feedId]
    );

    if (action === "like") {
      if (existingLike.rows.length > 0) {
        // Remove the like without affecting dislikes
        await pool.query("DELETE FROM feed_likes WHERE student_id = $1 AND feed_id = $2", [studentId, feedId]);
        await pool.query("UPDATE feeds SET likes = likes - 1 WHERE feed_id = $1", [feedId]);
      } else if (existingDislike.rows.length === 0) {
        // Add like only if user has not disliked
        await pool.query("INSERT INTO feed_likes (student_id, feed_id) VALUES ($1, $2)", [studentId, feedId]);
        await pool.query("UPDATE feeds SET likes = likes + 1 WHERE feed_id = $1", [feedId]);
      }
    } else if (action === "dislike") {
      if (existingDislike.rows.length > 0) {
        // Remove the dislike without affecting likes
        await pool.query("DELETE FROM feed_dislikes WHERE student_id = $1 AND feed_id = $2", [studentId, feedId]);
        await pool.query("UPDATE feeds SET dislikes = dislikes - 1 WHERE feed_id = $1", [feedId]);
      } else if (existingLike.rows.length === 0) {
        // Add dislike only if user has not liked
        await pool.query("INSERT INTO feed_dislikes (student_id, feed_id) VALUES ($1, $2)", [studentId, feedId]);
        await pool.query("UPDATE feeds SET dislikes = dislikes + 1 WHERE feed_id = $1", [feedId]);
      }
    }

    // Return updated likes & dislikes count
    const updatedCounts = await pool.query(
      "SELECT likes, dislikes FROM feeds WHERE feed_id = $1",
      [feedId]
    );

    res.json({ success: true, ...updatedCounts.rows[0] });
  } catch (err) {
    console.error("Error updating reaction:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});


  
module.exports = router;
