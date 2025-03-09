const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.unit_id,u.unit_code, u.unit_name, u.semester, u.year, u.lecturer, c.course_name 
       FROM units u
       JOIN courses c ON u.course_id = c.course_id
       ORDER BY u.unit_id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:course_id", async (req, res) => {
  try {
    const { course_id } = req.params;
    const { year, semester } = req.query;

    let query = `SELECT * FROM units WHERE course_id = $1`;
    let values = [course_id];

    if (year && semester) {
      query += ` AND year = $2 AND semester = $3 ORDER BY year, semester`;
      values.push(year, semester);
    } else {
      query += ` ORDER BY year, semester`;
    }

    const result = await pool.query(query, values);

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching units:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { unit_name, unit_code, lecturer, courseId, semester, year } = req.body;

    if (
      !unit_name ||
      !unit_code ||
      !lecturer ||
      !courseId ||
      !semester ||
      !year
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const newUnit = await pool.query(
      `INSERT INTO units (unit_code, unit_name, lecturer, course_id, semester, year) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [unit_code, unit_name, lecturer, courseId, semester, year]
    );

    const unit = newUnit.rows[0];
    res.status(201).json({ unit });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { unit_code, unit_name, lecturer, courseId, semester, year } = req.body;

  try {
    if (
      !unit_name ||
      !unit_code ||
      !lecturer ||
      !courseId ||
      !semester ||
      !year
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const updatedUnit = await pool.query(
      `UPDATE units 
       SET unit_code = $1, unit_name = $2, lecturer = $3, course_id = $4, semester = $5, year = $6 
       WHERE unit_id = $7 RETURNING *`,
      [unit_code, unit_name, lecturer, courseId, semester, year, id]
    );

    if (updatedUnit.rows.length === 0) {
      return res.status(404).json({ error: "Unit not found" });
    }
    const unit = updatedUnit.rows[0];
    res.status(201).json({ unit });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deletedUnit = await pool.query(
      "DELETE FROM units WHERE unit_id = $1 RETURNING *",
      [id]
    );

    if (deletedUnit.rows.length === 0) {
      return res.status(404).json({ error: "Unit not found" });
    }

    res.json({ message: "Unit deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/details/:unitId", async (req, res) => {
  const { unitId } = req.params;

  try {
    // Fetch unit details
    const unitQuery = `
      SELECT unit_id, unit_code, unit_name, lecturer 
      FROM units 
      WHERE unit_id = $1
    `;
    const unitResult = await pool.query(unitQuery, [unitId]);

    if (unitResult.rows.length === 0) {
      return res.status(404).json({ message: "Unit not found!" });
    }

    const unit = unitResult.rows[0];

    // Fetch resources for the unit
    const resourcesQuery = `
      SELECT resource_id, title, description, link, upload_date, file_type, resource_type 
      FROM resources 
      WHERE unit_id = $1
      ORDER BY upload_date DESC
    `;
    const resourcesResult = await pool.query(resourcesQuery, [unitId]);

    res.status(200).json({ unit, resources: resourcesResult.rows });
  } catch (err) {
    console.error("Error fetching unit details and resources:", err.message || err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
