const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/:course_id", async (req, res) => {
  try {
    const { course_id } = req.params;
    const { year, semester } = req.query;
    let query = `SELECT * FROM notifications WHERE course_id = $1`;
    let values = [course_id];

    if (year && semester) {
      query += ` AND year = $2 AND semester = $3 ORDER BY created_at DESC`;
      values.push(year, semester);
    } else {
      query += ` ORDER BY created_at DESC`;
    }

    const result = await pool.query(query, values);

    res.status(200).json({ notifications: result.rows });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add a new notification
router.post("/", async (req, res) => {
  const { courseId, year, semester, notification } = req.body;

  if (!notification || !year || !semester || !courseId) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO notifications (course_id, year, semester, notification) VALUES ($1, $2, $3, $4) RETURNING *",
      [courseId, year, semester, notification]
    );

    res.status(201).json({ notification: result.rows[0] });
  } catch (error) {
    console.error("Error adding notification:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deletedUnit = await pool.query(
      "DELETE FROM notifications WHERE id = $1 RETURNING *",
      [id]
    );

    if (deletedUnit.rows.length === 0) {
      return res.status(404).json({ error: "notification not found" });
    }

    res.json({ message: "Notification deleted deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
