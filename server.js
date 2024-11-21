const { exec } = require("child_process");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const pg = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require('fs');
const simpleGit = require('simple-git');
const multer = require("multer");
const app = express();
const { execSync } = require("child_process");
const PORT = 5000;

// Initialize database pool
const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Middleware
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

// JWT middleware to verify tokens
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Forbidden" });
    req.user = user;
    next();
  });
};
const { v2: cloudinary } = require("cloudinary");

// Configure Cloudinary
cloudinary.config({
  cloud_name: `${process.env.CLOUD_NAME}`, // Replace with your Cloudinary cloud name
  api_key: `${process.env.CLOUD_API_KEY}`,       // Replace with your Cloudinary API key
  api_secret: `${process.env.CLOUD_API_SECRET}`, // Replace with your Cloudinary API secret
});

// Configure Multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Function to upload file to Cloudinary
const uploadToCloudinary = (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url); // Return the secure URL of the uploaded file
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

// Create a resource route for Admin
app.post(
  "/admin/add-resource",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    const {
      title,
      description,
      year,
      semester,
      course,
      unitCode,
      resourceType,
    } = req.body;

    try {
      if (!req.file) {
        return res.status(400).json({ message: "File upload is required." });
      }

      // Upload file to Cloudinary
      const fileUrl = await uploadToCloudinary(req.file.buffer, "admin-resources");
      const fileType = path.extname(req.file.originalname).substring(1);

      // Save metadata to the database
      await pool.query(
        "INSERT INTO resources (title, description, year, semester, course, unitcode, filetype, resource_type, file_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [
          title,
          description,
          year,
          semester,
          course,
          unitCode,
          fileType,
          resourceType,
          fileUrl,
        ]
      );

      res.json({ message: "Resource added successfully!" });
    } catch (err) {
      console.error("Error adding resource:", err);
      res.status(500).json({ message: "Error adding resource" });
    }
  }
);

// Create a resource route for Class Rep
app.post(
  "/classrep/add-resource",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    const {
      title,
      description,
      year,
      semester,
      course,
      unitCode,
      resourceType,
    } = req.body;

    try {
      if (!req.file) {
        return res.status(400).json({ message: "File upload is required." });
      }

      // Upload file to Cloudinary
      const fileUrl = await uploadToCloudinary(req.file.buffer, "classrep-resources");
      const fileType = path.extname(req.file.originalname).substring(1);

      // Save metadata to the database
      await pool.query(
        "INSERT INTO resources (title, description, year, semester, course, unitcode, filetype, resource_type, file_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [
          title,
          description,
          year,
          semester,
          course,
          unitCode,
          fileType,
          resourceType,
          fileUrl,
        ]
      );

      res.json({ message: "Resource added successfully!" });
    } catch (err) {
      console.error("Error adding resource:", err);
      res.status(500).json({ message: "Error adding resource" });
    }
  }
);

// Register Route
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

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertQuery = `
      INSERT INTO students (email, password, first_name, last_name, year, semester, course, gender)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, first_name, last_name, course;
    `;
    const insertResult = await pool.query(insertQuery, [
      email,
      hashedPassword,
      first_name,
      last_name,
      year,
      semester,
      course,
      gender,
    ]);

    const newUser = insertResult.rows[0];
    res.status(201).json({ message: "Registration successful", user: newUser });
  } catch (err) {
    console.error("Error registering user:", err);
    res.status(500).json({ message: "Error registering user" });
  }
});

// Login Route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if login is for superadmin
    if (
      email === process.env.SUPER_USER &&
      password === process.env.SUPER_PASSWORD
    ) {
      const token = jwt.sign(
        { email, role: "superadmin" }, // Payload containing user info
        process.env.JWT_SECRET, // Secret key to sign the JWT
        { expiresIn: "1h" } // Token expiration (1 hour)
      );

      return res.json({
        message: "Login successful",
        token, // Return the JWT token
        redirectTo: "/superadmin",
      });
    }

    // Check if it's a classRep
    const classRepResult = await pool.query(
      "SELECT * FROM class_representatives WHERE email = $1",
      [email]
    );
    if (classRepResult.rows.length > 0) {
      const classRep = classRepResult.rows[0];
      const isClassRepPasswordValid = await bcrypt.compare(
        password,
        classRep.password
      );

      if (isClassRepPasswordValid) {
        const token = jwt.sign(
          {
            id: classRep.id,
            role: "classRep",
            email: classRep.email,
            firstName: classRep.first_name,
            lastName: classRep.last_name,
            year: classRep.year,
            course: classRep.course,
            semester: classRep.semester,
          },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );

        return res.json({
          message: "Login successful",
          token,
          redirectTo: "/classrep/dashboard",
        });
      } else {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    }

    // Check if it's an admin
    const adminResult = await pool.query(
      "SELECT * FROM admins WHERE email = $1",
      [email]
    );
    if (adminResult.rows.length > 0) {
      const admin = adminResult.rows[0];
      const isAdminPasswordValid = await bcrypt.compare(
        password,
        admin.password
      );

      if (isAdminPasswordValid) {
        const token = jwt.sign(
          {
            id: admin.id,
            role: "admin",
            email: admin.email,
            firstName: admin.first_name,
            lastName: admin.last_name,
          },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );

        return res.json({
          message: "Login successful",
          token,
          redirectTo: "/admin/dashboard",
        });
      } else {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    }

    // Check if it's a student
    const studentResult = await pool.query(
      "SELECT * FROM students WHERE email = $1",
      [email]
    );
    if (studentResult.rows.length > 0) {
      const student = studentResult.rows[0];
      const isStudentPasswordValid = await bcrypt.compare(
        password,
        student.password
      );

      if (isStudentPasswordValid) {
        const token = jwt.sign(
          {
            id: student.id,
            role: "student",
            email: student.email,
            firstName: student.first_name,
            lastName: student.last_name,
            course: student.course,
            year: student.year,
            semester: student.semester,
          },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );

        return res.json({
          message: "Login successful",
          token,
          redirectTo: "/dashboard",
        });
      } else {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    }

    // If no user found in any role
    return res.status(404).json({ error: "User not found" });
  } catch (err) {
    console.error("Error during login:", err);
    return res
      .status(500)
      .json({ error: "An error occurred. Please try again later." });
  }
});

// Create Admin Route
app.post("/superadmin/create-admin", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  // Validate input
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    // Check if the admin already exists by email
    const result = await pool.query("SELECT * FROM admins WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "Admin with this email already exists" });
    }

    // Hash the password before storing it in the database
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new admin into the database
    await pool.query(
      "INSERT INTO admins (first_name, last_name, email, password) VALUES ($1, $2, $3, $4)",
      [firstName, lastName, email, hashedPassword]
    );

    res.json({ message: "Admin created successfully" });
  } catch (err) {
    console.error("Error creating admin:", err);
    res.status(500).json({ message: "Error creating admin" });
  }
});

// Add Class Representative Route
app.post("/superadmin/create-class-rep", async (req, res) => {
  const { first_name, last_name, email, year, semester, password, course } =
    req.body;

  try {
    // Hash the password before saving it to the database
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert class representative data into the class_representatives table
    const result = await pool.query(
      "INSERT INTO class_representatives (first_name, last_name, email, year, semester, password, course) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [first_name, last_name, email, year, semester, hashedPassword, course]
    );

    // Send a success response with the created class rep data
    res.json({
      message: "Class Representative added successfully",
      classRep: result.rows[0],
    });
  } catch (err) {
    console.error("Error adding class representative: ", err);
    res.status(500).json({ message: "Error adding class representative" });
  }
});

// Generic Role Check Route
app.get("/user/check", (req, res) => {
  // Get the token from the Authorization header
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    // Verify the token using the JWT_SECRET
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // This will decode the payload

    // Check if the role is valid
    if (["admin", "superadmin", "classRep", "student"].includes(decoded.role)) {
      return res.json({ role: decoded.role }); // Return the role if valid
    } else {
      return res.status(403).json({ message: "Forbidden" }); // Return 403 if role is invalid
    }
  } catch (err) {
    console.error("Error verifying token:", err);
    return res.status(401).json({ message: "Invalid token or expired token" });
  }
});

app.get("/dashboard", (req, res) => {
  // Extract the token from the Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // Check if the role in the token is "student"
    if (decoded.role !== "student") {
      return res.status(403).json({
        message: "Access denied. You are not logged in as a student.",
      });
    }

    // If valid, send a response with user info (decoded token)
    res.json({
      message: `Welcome to the student dashboard, ${decoded.firstName}!`,
    });
  });
});

// Super Admin Dashboard Route (Protected)
app.get("/superadmin/dashboard", (req, res) => {
  // Extract token from Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // Check if the role is "superadmin"
    if (decoded.role !== "superadmin") {
      return res
        .status(403)
        .json({ message: "Access denied. You are not a superadmin." });
    }

    // If valid, send a success response
    res.json({ message: "Welcome to the Super Admin Dashboard!" });
  });
});

app.get("/classrep/dashboard", (req, res) => {
  // Extract token from Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // Check if the user role is classRep
    if (decoded.role !== "classRep") {
      return res.status(403).json({
        message: "Access denied. You are not logged in as a class rep.",
      });
    }

    res.json({
      message: `Welcome to the class rep dashboard, ${decoded.firstName}!`,
    });
  });
});

app.get("/admin/dashboard", (req, res) => {
  // Extract token from Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // Check if the user role is admin
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

// Get list of admins
app.get("/superadmin/admins", async (req, res) => {
  try {
    const totalAdminsResult = await pool.query("SELECT COUNT(*) FROM admins");
    const totalAdmins = totalAdminsResult.rows[0].count;

    const result = await pool.query("SELECT * FROM admins ORDER BY id DESC");
    res.json({ totalAdmins, admins: result.rows });
  } catch (err) {
    console.error("Error fetching admins:", err);
    res.status(500).json({ message: "Error fetching admins" });
  }
});

// Get list of class representatives
app.get("/superadmin/classreps", async (req, res) => {
  try {
    const totalClassRepsResult = await pool.query(
      "SELECT COUNT(*) FROM class_representatives"
    );
    const totalClassReps = totalClassRepsResult.rows[0].count;

    const result = await pool.query(
      "SELECT * FROM class_representatives ORDER BY id DESC"
    );
    res.json({ totalClassReps, classReps: result.rows });
  } catch (err) {
    console.error("Error fetching class representatives:", err);
    res.status(500).json({ message: "Error fetching class representatives" });
  }
});

// Get list of students
app.get("/superadmin/students", async (req, res) => {
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

// SuperAdmin Route to fetch total resources and list all resources
app.get("/superadmin/resources", async (req, res) => {
  try {
    // Query to get the total number of resources
    const totalResourcesResult = await pool.query(
      "SELECT COUNT(*) FROM resources"
    );
    const totalResources = totalResourcesResult.rows[0].count;

    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources ORDER BY created_at DESC"
    );
    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      totalResources,
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/recent-resources", async (req, res) => {
  // Extract token from Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // Get user details from the decoded token
    const { year, course, semester } = decoded;

    try {
      // Query to get all resources based on user's year, course, and semester
      const resourcesResult = await pool.query(
        "SELECT * FROM resources WHERE course = $1 AND year = $2 AND semester = $3 ORDER BY created_at DESC LIMIT 4",
        [course, year, semester]
      );
      const resources = resourcesResult.rows;

      // Send the list of resources to the frontend
      res.json({ resources });
    } catch (err) {
      console.error("Error fetching resources:", err);
      res.status(500).json({ message: "Error fetching resources" });
    }
  });
});

app.get("/user/profile", (req, res) => {
  // Extract token from Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    // Extract user data from the decoded token
    const { firstName, lastName, email, course, year, semester, role } =
      decoded;

    try {
      // Return the user profile data
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
  // Extract the token from the Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "User not logged in" });
  }

  // Verify the JWT token
  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const { email, role } = decoded; // Get email and role from the decoded token
    const { firstName, lastName, course, year, semester } = req.body;

    // Map roles to their corresponding tables and update logic
    const roleConfig = {
      student: {
        table: "students",
        columns:
          "first_name = $1, last_name = $2, course = $3, year = $4, semester = $5",
        values: [firstName, lastName, course, year, semester, email],
      },
      classRep: {
        table: "class_representatives",
        columns:
          "first_name = $1, last_name = $2, course = $3, year = $4, semester = $5",
        values: [firstName, lastName, course, year, semester, email],
      },
      admin: {
        table: "admins",
        columns: "first_name = $1, last_name = $2",
        values: [firstName, lastName, email], // Admins might not need course/year/semester
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

      // Return updated user data (no need to update session)
      res.json({
        message: "Profile updated successfully",
        user: result.rows[0],
      });
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

// Route to fetch notes resources
app.get("/student/notes-resources", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = await verifyToken(token);
    const { year, course, semester } = decoded;

    if (!year || !course || !semester) {
      return res.status(400).json({ message: "Missing user data from token" });
    }

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC LIMIT 4",
      ["Notes", course, year, semester]
    );
    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

// Route to fetch all notes resources
app.get("/student/all-notes-resources", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = await verifyToken(token);
    const { year, course, semester } = decoded;

    if (!year || !course || !semester) {
      return res.status(400).json({ message: "Missing user data from token" });
    }

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC",
      ["Notes", course, year, semester]
    );
    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

// Route to fetch all papers resources
app.get("/student/all-papers-resources", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = await verifyToken(token);
    const { year, course, semester } = decoded;

    if (!year || !course || !semester) {
      return res.status(400).json({ message: "Missing user data from token" });
    }

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC",
      ["Past Paper", course, year, semester]
    );
    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

// Route to fetch all tasks resources
app.get("/student/all-tasks-resources", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = await verifyToken(token);
    const { year, course, semester } = decoded;

    if (!year || !course || !semester) {
      return res.status(400).json({ message: "Missing user data from token" });
    }

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC",
      ["Task", course, year, semester]
    );
    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

// Route to fetch papers resources with a limit
app.get("/student/papers-resources", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = await verifyToken(token);
    const { year, course, semester } = decoded;

    if (!year || !course || !semester) {
      return res.status(400).json({ message: "Missing user data from token" });
    }

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC LIMIT 4",
      ["Past Paper", course, year, semester]
    );
    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

// Route to fetch tasks resources with a limit
app.get("/student/tasks-resources", async (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = await verifyToken(token);
    const { year, course, semester } = decoded;

    if (!year || !course || !semester) {
      return res.status(400).json({ message: "Missing user data from token" });
    }

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC LIMIT 4",
      ["Task", course, year, semester]
    );
    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

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
app.get("/resource-adder/check", (req, res) => {
  // Extract token from Authorization header
  const token = req.headers["authorization"]?.split(" ")[1]; // 'Bearer <token>'

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // Verify the JWT token
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

const startServer = () => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
