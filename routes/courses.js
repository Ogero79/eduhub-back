const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM courses ORDER BY course_name ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { course_name } = req.body;

    if (!course_name) {
      return res.status(400).json({ error: "Course name is required" });
    }

    const newCourse = await pool.query(
      "INSERT INTO courses (course_name) VALUES ($1) RETURNING *",
      [course_name]
    );

    res.status(201).json(newCourse.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { course_name } = req.body;
    await pool.query(
      "UPDATE courses SET course_name = $1 WHERE course_id = $2",
      [course_name, id]
    );
    res.json({ message: "Course updated successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM courses WHERE course_id = $1", [id]);
    res.json({ message: "Course deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
