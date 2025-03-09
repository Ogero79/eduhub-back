const { exec } = require("child_process");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const simpleGit = require("simple-git");
const multer = require("multer");
const app = express();
const streamifier = require("streamifier");
const cloudinary = require("cloudinary").v2;
const pool = require("./db");
const crypto = require("crypto");

const sendEmail = require("./emailService");
const PORT = 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  process.env.FRONTEND_URL_DEV,
  process.env.FRONTEND_URL_PROD,
  process.env.FRONTEND_URL_STAGING,
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"), false);
      }
    },
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
    credentials: true,
  })
);

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Forbidden" });
    req.user = user;
    next();
  });
};

cloudinary.config({
  cloud_name: `${process.env.CLOUD_NAME}`,
  api_key: `${process.env.CLOUD_API_KEY}`,
  api_secret: `${process.env.CLOUD_API_SECRET}`,
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadFileToCloudinary = async (file) => {
  return new Promise((resolve, reject) => {
    const fileParts = file.originalname.split(".");
    const fileExtension = fileParts.pop().toLowerCase(); // Get the last extension
    const baseName = fileParts.join(".").replace(/\s/g, "_"); // Remove spaces and keep original name without extension
    const uniqueName = `${baseName}`; // Ensure unique name without duplicate extension

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: ["pdf", "doc", "docx", "ppt", "txt"].includes(
          fileExtension
        )
          ? "raw"
          : "auto",
        folder: "resources",
        public_id: uniqueName, // Ensures no duplicate extensions
        format: fileExtension, // Explicitly set format to keep the correct extension
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    uploadStream.end(file.buffer);
  });
};



const coursesRoutes = require("./routes/courses");
const unitsRoutes = require("./routes/units");
const notificationsRoutes = require("./routes/notifications");
const feedsRoutes = require("./routes/feeds");
const superadminRoutes = require("./routes/superadmin");

app.use("/notifications", notificationsRoutes);
app.use("/courses", coursesRoutes);
app.use("/units", unitsRoutes);
app.use("/feeds", feedsRoutes);
app.use("/superadmin", superadminRoutes);


app.post("/resources", upload.single("file"), async (req, res) => {
  const { title, description, unitId, resource_type } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: "No file uploaded!" });
  }

  // Validate resourceType
  const validResourceTypes = ["Notes", "Papers", "Tasks"];
  if (!validResourceTypes.includes(resource_type)) {
    return res.status(400).json({ message: "Invalid resource type!" });
  }

  try {
    // Upload file to Cloudinary
    const result = await uploadFileToCloudinary(file);

    const fileType = file.originalname.split(".").pop().toLowerCase();
    const fileUrl = result.secure_url;

    // Insert into database
    await pool.query(
      `INSERT INTO resources (unit_id, title, description, link, file_type, resource_type) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [unitId, title, description, fileUrl, fileType, resource_type]
    );

    res.status(201).json({ message: "Resource added successfully!", fileUrl });
  } catch (err) {
    console.error("Error adding resource:", err.message || err);
    res
      .status(500)
      .json({ message: "Error adding resource", error: err.message });
  }
});

app.delete("/resources/:resourceId", async (req, res) => {
  const { resourceId } = req.params;

  try {
    const result = await pool.query("DELETE FROM resources WHERE resource_id = $1 RETURNING *", [resourceId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Resource not found" });
    }

    res.json({ message: "Resource deleted successfully" });
  } catch (error) {
    console.error("Error deleting resource:", error);
    res.status(500).json({ error: "Server error" });
  }
});


app.post("/feeds", upload.single("file"), async (req, res) => {
  const { courseId, year, semester, description } = req.body;
  const file = req.file;

  if (!file || !description || !year || !semester || !courseId) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const result = await uploadFileToCloudinary(file);
    const fileUrl = result.secure_url;

    await pool.query(
      `INSERT INTO feeds (course_id, year, semester, description, image_path) 
         VALUES ($1, $2, $3, $4, $5)`,
      [courseId, year, semester, description, fileUrl]
    );

    res.status(201).json({ message: "feed added successfully!", fileUrl });
  } catch (error) {
    console.error("Error adding feed:", error.message || error);
    res
      .status(500)
      .json({ message: "Error adding feed", error: error.message });
  }
});

app.post("/register", async (req, res) => {
  const {
    email,
    password,
    first_name,
    last_name,
    year,
    semester,
    course,
    gender,
  } = req.body;

  try {
    const result = await pool.query("SELECT * FROM students WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const courseResult = await pool.query(
      "SELECT course_id FROM courses WHERE course_name = $1",
      [course]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const course_id = courseResult.rows[0].course_id;

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertQuery = `
      INSERT INTO students (email, password, first_name, last_name, year, semester, course_id, gender)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, first_name, last_name, course_id;
    `;
    const insertResult = await pool.query(insertQuery, [
      email,
      hashedPassword,
      first_name,
      last_name,
      year,
      semester,
      course_id,
      gender,
    ]);

    const newUser = insertResult.rows[0];
    res.status(201).json({ message: "Registration successful", user: newUser });
  } catch (err) {
    console.error("Error registering user:", err);
    res.status(500).json({ message: "Error registering user" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if Superadmin
    if (
      email === process.env.SUPER_USER &&
      password === process.env.SUPER_PASSWORD
    ) {
      const token = jwt.sign(
        { email, role: "superadmin" },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        message: "Login successful",
        token,
        redirectTo: "/superadmin",
      });
    }

    
    // Check if student exists
    const studentResult = await pool.query(
      "SELECT id, first_name, last_name, email, password, course_id, year, semester, user_role FROM students WHERE email = $1",
      [email]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const student = studentResult.rows[0];

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, student.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const courseResult = await pool.query(
      "SELECT course_name FROM courses WHERE course_id = $1",
      [student.course_id]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const course = courseResult.rows[0].course_name;
    // Generate JWT token
    const token = jwt.sign(
      {
        id: student.id,
        role: student.user_role,
        email: student.email,
        firstName: student.first_name,
        lastName: student.last_name,
        courseId: student.course_id,
        course,
        year: student.year,
        semester: student.semester,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      message: "Login successful",
      token,
      redirectTo: "/dashboard",
    });
  } catch (err) {
    console.error("Error during login:", err);
    return res
      .status(500)
      .json({ error: "An error occurred. Please try again later." });
  }
});

app.get("/user/check", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (["superadmin", "classRep", "student"].includes(decoded.role)) {
      return res.json({ role: decoded.role });
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }
  } catch (err) {
    console.error("Error verifying token:", err);
    return res.status(401).json({ message: "Invalid token or expired token" });
  }
});

app.get("/dashboard", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const { id, role, course, courseId, firstName, lastName, year, semester } = decoded;

    if (role !== "student" && role !== "classRep") {
      return res.status(403).json({
        message: "Access denied. You are not logged in as a student.",
      });
    }

    res.json({
      id,
      firstName,
      lastName,
      courseId,
      role,
      course,
      year,
      semester,
    });
  });
});

app.get("/superadmin/dashboard", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    if (decoded.role !== "superadmin") {
      return res
        .status(403)
        .json({ message: "Access denied. You are not a superadmin." });
    }

    res.json({ message: "Welcome to the Super Admin Dashboard!" });
  });
});

app.get("/classrep/dashboard", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const { role, course, courseId, firstName, year, semester } = decoded;
    if (role !== "classRep") {
      return res.status(403).json({
        message: "Access denied. You are not logged in as a class rep.",
      });
    }

    res.json({
      firstName,
      courseId,
      role,
      course,
      year,
      semester,
    });
  });
});

app.get("/admin/dashboard", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    if (decoded.role !== "admin") {
      return res.status(403).json({
        message: "Access denied. You are not logged in as an admin.",
      });
    }

    res.json({
      message: `Welcome to the admin dashboard, ${decoded.firstName}!`,
    });
  });
});

app.get("/user/profile", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const { firstName, lastName, email, course, year, semester, role } =
      decoded;

    try {
      res.json({
        firstName,
        lastName,
        email,
        course,
        year,
        semester,
        role,
      });
    } catch (err) {
      console.error("Error fetching user profile:", err);
      res.status(500).json({ message: "Error fetching user profile" });
    }
  });
});

app.put("/user/profile", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "User not logged in" });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const { email, role } = decoded;
    const { firstName, lastName, course, year, semester } = req.body;
    const courseResult = await pool.query(
      "SELECT course_id FROM courses WHERE course_name = $1",
      [course]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const course_id = courseResult.rows[0].course_id;
    const roleConfig = {
      student: {
        table: "students",
        columns:
          "first_name = $1, last_name = $2, course_id = $3, year = $4, semester = $5",
        values: [firstName, lastName, course_id, year, semester, email],
      },
      classRep: {
        table: "class_representatives",
        columns:
          "first_name = $1, last_name = $2, course_id = $3, year = $4, semester = $5",
        values: [firstName, lastName, course_id, year, semester, email],
      },
      admin: {
        table: "admins",
        columns: "first_name = $1, last_name = $2",
        values: [firstName, lastName, email],
      },
    };

    const config = roleConfig[role];
    if (!config) {
      return res.status(403).json({ message: "Unauthorized role" });
    }

    try {
      const query = `
        UPDATE ${config.table}
        SET ${config.columns}
        WHERE email = $${config.values.length}
        RETURNING *;
      `;

      const result = await pool.query(query, config.values);

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      if (role === "student") {
        const studentResult = await pool.query(
          "SELECT s.*, c.course_name FROM students s LEFT JOIN courses c ON s.course_id = c.course_id WHERE s.email = $1",
          [email]
        );

        student = studentResult.rows[0];
        const token = jwt.sign(
          {
            id: student.id,
            role: "student",
            email: student.email,
            firstName: student.first_name,
            lastName: student.last_name,
            course: student.course_name,
            courseId: student.course_id,
            year: student.year,
            semester: student.semester,
          },
          process.env.JWT_SECRET,
          { expiresIn: "30d" }
        );

        res.json({
          message: "profile updated successfully",
          token,
        });
      }
      if (role === "classRep") {
        const classRepResult = await pool.query(
          "SELECT cr.*, c.course_name FROM class_representatives cr LEFT JOIN courses c ON cr.course_id = c.course_id WHERE cr.email = $1;",
          [email]
        );

        const classRep = classRepResult.rows[0];
        const token = jwt.sign(
          {
            id: classRep.id,
            role: "classRep",
            email: classRep.email,
            firstName: classRep.first_name,
            lastName: classRep.last_name,
            year: classRep.year,
            course: classRep.course_name,
            courseId: classRep.course_id,
            semester: classRep.semester,
          },
          process.env.JWT_SECRET,
          { expiresIn: "30d" }
        );

        res.json({
          message: "profile updated successfully",
          token,
        });
      }
    } catch (err) {
      console.error("Error updating profile:", err);
      res.status(500).json({ message: "Error updating profile" });
    }
  });
});

const verifyToken = (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
};

const deleteEntity = async (table, id) => {
  try {
    const deleteResult = await pool.query(
      `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
      [id]
    );
    if (deleteResult.rows.length === 0) {
      throw new Error(`${table.slice(0, -1)} not found`);
    }
    return deleteResult.rows[0];
  } catch (err) {
    throw new Error(`Error deleting ${table.slice(0, -1)}: ${err.message}`);
  }
};

app.delete("/superadmin/:entity/:id", async (req, res) => {
  const { entity, id } = req.params;

  const tableMap = {
    classreps: "class_representatives",
    students: "students",
    admins: "admins",
    resources: "resources",
  };

  const table = tableMap[entity.toLowerCase()];
  if (!table) {
    return res.status(400).json({ message: "Invalid entity type" });
  }

  try {
    const deletedEntity = await deleteEntity(table, id);
    res.json({
      message: `${entity.slice(0, -1)} deleted successfully`,
      deletedEntity,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message });
  }
});

app.delete("/superadmin/:entity/:id", async (req, res) => {
  const { entity, id } = req.params;

  const tableMap = {
    classreps: "class_representatives",
    students: "students",
    admins: "admins",
    resources: "resources",
  };

  const table = tableMap[entity.toLowerCase()];
  if (!table) {
    return res.status(400).json({ message: "Invalid entity type" });
  }

  try {
    const deletedEntity = await deleteEntity(table, id);
    res.json({
      message: `${entity.slice(0, -1)} deleted successfully`,
      deletedEntity,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message });
  }
});
app.get("/resource-adder/check", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const { role, course, year, semester } = decoded;

    if (!role) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const response = { role };
    if (role === "classRep") {
      Object.assign(response, { course, year, semester });
    }

    res.json(response);
  });
});

app.put("/students/:studentId/change-password", async (req, res) => {
  const { studentId } = req.params;
  const { currentPassword, newPassword } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT password FROM students WHERE id = $1",
      [studentId]
    );
    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    const currentHash = userResult.rows[0].password;

    const isMatch = await bcrypt.compare(currentPassword, currentHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE students SET password = $1 WHERE id = $2", [
      newHash,
      studentId,
    ]);
    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/support-messages", async (req, res) => {
  const { userId, email, message } = req.body;

  if (!email || !message) {
    return res.status(400).json({ message: "Email and message are required." });
  }

  try {
    await pool.query(
      `INSERT INTO support_messages (user_id, email, message) 
           VALUES ($1, $2, $3)`,
      [userId, email, message]
    );
    res.status(201).json({
      message:
        "Your message has been sent. Our support team will contact you shortly.",
    });
  } catch (error) {
    console.error("Error saving support message:", error);
    res.status(500).json({
      message: "Failed to send your message. Please try again later.",
    });
  }
});

app.post("/feedbacks", async (req, res) => {
  const { userId, email, rating, feedback } = req.body;

  if (!rating || !feedback) {
    return res
      .status(400)
      .json({ message: "Rating and feedback are required." });
  }

  try {
    await pool.query(
      `INSERT INTO feedback (user_id, email, rating, feedback) 
           VALUES ($1, $2, $3, $4)`,
      [userId, email, rating, feedback]
    );
    res.status(201).json({ message: "Thank you for your feedback!" });
  } catch (error) {
    console.error("Error saving feedback:", error);
    res
      .status(500)
      .json({ message: "Failed to submit feedback. Please try again later." });
  }
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const userRes = await pool.query(
      "SELECT id FROM students WHERE email = $1",
      [email]
    );
    if (userRes.rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "UPDATE students SET reset_token = $1, reset_token_expiry = NOW() + INTERVAL '5 minutes' WHERE email = $2",
      [token, email]
    );

    const resetLink = `http://localhost:5173/reset-password/${token}`;

    (async () => {
      try {
        await sendEmail(
          email,
          "Password Reset Request",
          `Click the link to reset your password: ${resetLink}`
        );
      } catch (error) {
        console.error("Failed to send email:", error);
      }
    })();

    res.json({ message: "Password reset link sent" });
  } catch (error) {
    console.error("Failed to send email:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    const userRes = await pool.query(
      "SELECT id,email FROM students WHERE reset_token = $1 AND reset_token_expiry > NOW()",
      [token]
    );
    if (userRes.rows.length === 0)
      return res.status(400).json({ message: "Invalid or expired token" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "UPDATE students SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE reset_token = $2",
      [hashedPassword, token]
    );

    const email = userRes.rows[0].email;

    (async () => {
      try {
        await sendEmail(
          email,
          "Password Reset",
          `Your password was reset successfully!`,
          "<h5>Your password was reset successfully!</h5>"
        );
      } catch (error) {
        console.error("Failed to send email:", error);
      }
    })();

    res.json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/resend-reset-link", async (req, res) => {
  const { token } = req.body;

  try {
    // Get user by expired token
    const userRes = await pool.query(
      "SELECT email FROM students WHERE reset_token = $1",
      [token]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "Invalid or expired token." });
    }

    const email = userRes.rows[0].email;

    // Generate a new reset token
    const newToken = crypto.randomBytes(32).toString("hex");

    // Update DB with new token and expiry
    await pool.query(
      "UPDATE students SET reset_token = $1, reset_token_expiry = NOW() + INTERVAL '5 minutes' WHERE email = $2",
      [newToken, email]
    );

    const resetLink = `http://localhost:5173/reset-password/${newToken}`;

    // Send new reset email
    await sendEmail(
      email,
      "Password Reset Request",
      `Click here: ${resetLink}`
    );

    res.json({ message: "A new reset link has been sent to your email." });
  } catch (error) {
    console.error("Resend reset link error:", error);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});

const startServer = () => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
