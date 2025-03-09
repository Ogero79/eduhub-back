const express = require("express");
const router = express.Router();
const pool = require("../db"); 
const sendEmail = require("../emailService");

router.get("/resources", async (req, res) => {
  try {
    const totalResourcesResult = await pool.query(
      "SELECT COUNT(*) FROM resources"
    );
    const totalResources = totalResourcesResult.rows[0].count;

    const resourcesResult = await pool.query(
      "SELECT * FROM resources ORDER BY upload_date DESC"
    );
    const resources = resourcesResult.rows;

    res.json({
      totalResources,
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

router.post('/assign-class-rep', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const student = await pool.query('SELECT id FROM students WHERE email = $1', [email]);

    if (student.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    await pool.query('UPDATE students SET user_role = $1 WHERE email = $2', ['classRep', email]);

    (async () => {
      try {
        await sendEmail(
          email,
          "Class Representative Assignment",
          `Dear Student,\n\nYou have been assigned as the Class Representative.\n\nPlease check with the administration for further details.\n\nBest regards,\nAdmin Team`
        );
      } catch (error) {
        console.error("Failed to send email:", error);
      }
    })();

    res.json({ message: 'Class representative assigned successfully and notified via email.' });

  } catch (error) {
    console.error('Error assigning class representative:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get("/classreps", async (req, res) => {
  try {
    const totalClassRepsResult = await pool.query(
      "SELECT COUNT(*) FROM students WHERE user_role = 'classRep'"
    );
    const totalClassReps = totalClassRepsResult.rows[0].count;

    const result = await pool.query(
      "SELECT * FROM students WHERE user_role = 'classRep' ORDER BY id DESC"
    );

    res.json({ totalClassReps, classReps: result.rows });
  } catch (err) {
    console.error("Error fetching class representatives:", err);
    res.status(500).json({ message: "Error fetching class representatives" });
  }
});

router.get("/students", async (req, res) => {
  try {
    const totalStudentsResult = await pool.query(
      "SELECT COUNT(*) FROM students"
    );
    const totalStudents = totalStudentsResult.rows[0].count;

    const totalFemaleStudentsResult = await pool.query(
      "SELECT COUNT(*) FROM students WHERE gender = $1",
      ["Female"]
    );
    const totalFemaleStudents = totalFemaleStudentsResult.rows[0].count;

    const totalMaleStudentsResult = await pool.query(
      "SELECT COUNT(*) FROM students WHERE gender = $1",
      ["Male"]
    );
    const totalMaleStudents = totalMaleStudentsResult.rows[0].count;

    const result = await pool.query("SELECT * FROM students ORDER BY id DESC");
    res.json({
      totalStudents,
      totalFemaleStudents,
      totalMaleStudents,
      students: result.rows,
    });
  } catch (err) {
    console.error("Error fetching students:", err);
    res.status(500).json({ message: "students" });
  }
});


module.exports = router;
